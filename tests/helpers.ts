/**
 * Test harness for the endpoint tests.
 *
 * The app is mounted for real — real middleware chain, real error boundary, real
 * database — on an ephemeral port. No supertest, no mocks: a test that stubs the
 * session lookup would pass while the actual session lookup was broken, which is
 * exactly the bug these tests exist to catch.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
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

/** Unique per run, so a re-run does not collide with rows the last one left. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.invalid`;
}

/**
 * Removes only what a test created, matched on the `.test.invalid` domain.
 * Deliberately narrow: a test suite that truncates tables would destroy the
 * seeded demo data on the machine it runs on.
 */
export async function cleanupTestRows(): Promise<void> {
  await query("DELETE FROM users WHERE email LIKE '%@test.invalid'");
  await query("DELETE FROM contacts WHERE email LIKE '%@test.invalid'");
  await query("DELETE FROM customers WHERE name LIKE 'TEST %'");
  await query("DELETE FROM customer_tiers WHERE name LIKE 'TEST %'");
}
