/**
 * The database boundary. `pg` with raw, parameterised SQL — no ORM, because the
 * master prompt asks for demonstrable database design and an ORM hides exactly
 * that (TRD.md §1).
 *
 * Two rules this module exists to enforce:
 *   1. Every value crossing into SQL goes through a `$n` placeholder. There is
 *      no interface here that takes a string-built query.
 *   2. Multi-table writes run inside `withTransaction`, so an audit entry can
 *      never survive a rollback of the change it describes (TRD.md §7).
 */
import pg from "pg";
import { env } from "./env.ts";

/**
 * `BIGINT` arrives from pg as a string, because a 64-bit integer does not fit
 * in a JS number. Every bigint we actually select is either an id or a money
 * amount in cents, both far inside Number.MAX_SAFE_INTEGER, so parsing to a
 * number here is what makes `shared/types.ts` honest — `Cents` is declared as a
 * number and must arrive as one.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

/**
 * `NUMERIC` also arrives as a string, for the same reason. Our NUMERICs are
 * percentages and scores with three decimal places; they are compared against
 * thresholds and rendered, so they must be numbers, not "18.000".
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<T[]> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows;
}

/** The common case: a lookup that legitimately may find nothing. */
export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

/**
 * Mandatory for stock reservation, order confirmation, payment recording,
 * subscription changes and every other multi-table write (TRD.md §7).
 *
 * The callback receives the client; every query inside must be passed it, or it
 * runs on a different connection and is not in the transaction at all.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      // The rollback itself failing means the connection is gone; the original
      // error is the one worth reporting, so it is not masked here.
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
