/**
 * Test harness for the endpoint tests.
 *
 * The app is mounted for real — real middleware chain, real error boundary, real
 * database — on an ephemeral port. No supertest, no mocks: a test that stubbed
 * the session lookup would pass while the actual session lookup was broken,
 * which is exactly the bug these tests exist to catch.
 *
 * ─── WHY NAMESPACES ─────────────────────────────────────────────────────────
 *
 * `node --test` runs one process per FILE, in parallel, against one database.
 * Cleanup that matched every `%@test.invalid` row therefore deleted users
 * another file was mid-transaction on — and since `quotations.owner_user_id` is
 * ON DELETE RESTRICT, the two processes sat waiting on each other's row locks
 * until the suite timed out. Individually each file took two seconds; together
 * they hung.
 *
 * So every file gets its own email domain and its own name prefix, and only
 * ever deletes rows carrying them. Parallelism is worth keeping — the fix is
 * for the files not to share data, rather than to serialise them and let the
 * shared-state bug survive until the suite is slow enough to notice.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { closePool, pool, query } from "../server/lib/db.ts";
import { resetRateLimits } from "../server/middleware/rateLimit.ts";

export interface Harness {
  url: string;
  stop: () => Promise<void>;
}

/** True if a database is actually reachable, so tests can say so and skip. */
export async function databaseAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function startHarness(): Promise<Harness> {
  resetRateLimits();
  const server: Server = createServer(createApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      server.close();
      await once(server, "close");
      await closePool();
    },
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/** A thin fetch wrapper that never throws on a non-2xx — status is the assertion. */
export async function call<T = unknown>(
  harness: Harness,
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${harness.url}${path}`, {
    method,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (res.status === 204) return { status: res.status, body: undefined as T };
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * One file's private slice of the database. `tag` must be unique per test file.
 */
export interface Namespace {
  /** A fresh address in this file's own domain. */
  email(prefix: string): string;
  /**
   * A stable name only this file's cleanup will match. Deterministic, so a
   * test can assert on the name it just created — the namespace prefix is what
   * provides isolation, not randomness.
   */
  name(label: string): string;
  /** For the few columns with a UNIQUE constraint, where a leftover row from a
   *  previous run would otherwise collide. */
  uniqueName(label: string): string;
  /**
   * Removes exactly what this file created, in dependency order. Deliberately
   * narrow: a suite that truncated tables would destroy the seeded demo data on
   * the machine it runs on.
   */
  cleanup(): Promise<void>;
}

export function namespace(tag: string): Namespace {
  const domain = `${tag}.test.invalid`;
  const like = `%@${domain}`;
  const namePrefix = `TEST_${tag}`;

  return {
    email: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}@${domain}`,
    name: (label) => `${namePrefix} ${label}`,
    uniqueName: (label) => `${namePrefix} ${label} ${randomUUID().slice(0, 8)}`,

    async cleanup() {
      // Children before parents: every FK below is RESTRICT or would otherwise
      // block, and the order here is the whole reason cleanup is a function
      // rather than a list of deletes copied into each file.
      await query(
        `DELETE FROM quotations
          WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [like],
      );
      await query(
        `DELETE FROM quotations
          WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE $1)`,
        [`${namePrefix}%`],
      );
      await query("DELETE FROM price_list_items WHERE price_list_id IN (SELECT id FROM price_lists WHERE name LIKE $1)", [`${namePrefix}%`]);
      await query("DELETE FROM price_lists WHERE name LIKE $1", [`${namePrefix}%`]);
      await query("DELETE FROM products WHERE name LIKE $1", [`${namePrefix}%`]);
      await query("DELETE FROM contacts WHERE email LIKE $1", [like]);
      await query("DELETE FROM customers WHERE name LIKE $1", [`${namePrefix}%`]);
      await query("DELETE FROM customer_tiers WHERE name LIKE $1", [`${namePrefix}%`]);
      await query("DELETE FROM users WHERE email LIKE $1", [like]);
    },
  };
}
