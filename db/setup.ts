/**
 * Migration runner. `npm run db:setup`, or `npm run db:reset` to start clean.
 *
 * Deliberately about eighty lines rather than a migration framework:
 *
 *  - Each file runs inside its own transaction. A migration that fails halfway
 *    leaves nothing behind, so re-running after a fix is safe.
 *  - Applied files are recorded in `schema_migrations`, so setup is idempotent
 *    and a judge can run it twice without thinking about it.
 *  - A file that has already been applied but whose contents have since changed
 *    is a hard error, not a warning. Editing a shipped migration is how two
 *    developers' databases silently diverge (GIT_WORKFLOW.md §3).
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { closePool, pool } from "../server/lib/db.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

interface AppliedRow {
  filename: string;
  checksum: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * `--reset` drops the whole public schema. Destructive by design and by name:
 * it is the one-command path back to a known demo state, and our own rehearsal
 * safety net (TRD.md §2.3).
 */
async function reset(): Promise<void> {
  console.log("Dropping schema public — every table and row goes with it.");
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

async function run(): Promise<void> {
  if (process.argv.includes("--reset")) await reset();

  await ensureMigrationsTable();

  const applied = new Map<string, string>();
  const { rows } = await pool.query<AppliedRow>("SELECT filename, checksum FROM schema_migrations");
  for (const row of rows) applied.set(row.filename, row.checksum);

  // Lexicographic order over zero-padded numeric prefixes is chronological
  // order, which is why the files are named 001_, 002_ and not 1_, 2_.
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  let ran = 0;
  for (const filename of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(filename);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `${filename} has already been applied but its contents have changed.\n` +
            "Never edit a pushed migration — add a new numbered file instead, or run " +
            "npm run db:reset to rebuild from scratch.",
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
        filename,
        checksum,
      ]);
      await client.query("COMMIT");
      console.log(`  applied ${filename}`);
      ran += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${filename} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  console.log(
    ran === 0 ? "Database already up to date." : `Database up to date — ${ran} migration(s) applied.`,
  );
}

try {
  await run();
} catch (error) {
  console.error(`\nSetup failed. ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
