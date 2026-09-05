/**
 * Process entry point: bind a port, verify the database is actually reachable,
 * and shut down cleanly.
 *
 * The connection check at boot is deliberate. A server that starts happily and
 * fails on the first query turns "Postgres is not running" into a mysterious
 * 500 during a demo; failing here turns it into one sentence naming the fix.
 */
import process from "node:process";
import { createApp } from "./app.ts";
import { env, isProduction } from "./lib/env.ts";
import { closePool, pool } from "./lib/db.ts";
import { log } from "./lib/log.ts";

async function main(): Promise<void> {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    log.error("Could not reach the database", error, { databaseUrl: "[redacted]" });
    console.error(
      "\nThe API could not connect to PostgreSQL.\n" +
        "  1. Is the server running?\n" +
        "  2. Does DATABASE_URL in .env point at it?\n" +
        "  3. Have you run `npm run db:setup`?\n",
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    log.info("API listening", { port: env.port, env: env.nodeEnv, production: isProduction });
  });

  // Ctrl-C mid-demo should not leave a connection pool holding rows.
  const shutdown = (signal: string) => {
    log.info("Shutting down", { signal });
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

await main();
