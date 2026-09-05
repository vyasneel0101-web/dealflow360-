/**
 * Slice 1 acceptance tests (PHASE3_PLAN.md):
 *   - a password is never stored in plaintext
 *   - a portal token is rejected by internal middleware
 *
 * Plus the enumeration and mass-assignment properties the TRD claims, because a
 * claim in a document that nothing checks is a claim that quietly stops being
 * true around hour nine.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query, queryOne } from "../server/lib/db.ts";
import { generateToken, hashToken } from "../server/lib/crypto.ts";
import { env } from "../server/lib/env.ts";
import {
  call,
  cleanupTestRows,
  databaseAvailable,
  startHarness,
  uniqueEmail,
  type Harness,
} from "./helpers.ts";
import type { ApiError, ApiSuccess, AuthResponse, Id, User } from "../shared/types.ts";

const PASSWORD = "a-long-enough-test-password";

/**
 * Resolved at module load, not in a `before` hook: `describe({ skip })` is
 * evaluated while the file is being read, so a value set later would always
 * read as false and every test would run against no database.
 */
const available = await databaseAvailable();

if (!available) {
  // Said out loud rather than silently skipped. A green run that tested nothing
  // is worse than a red one.
  console.error(
    "\n  SKIPPING auth endpoint tests — no database at DATABASE_URL.\n" +
      "  Run `npm run db:setup` first.\n",
  );
} else {
  await cleanupTestRows();
}

const harness: Harness | null = available ? await startHarness() : null;

/** Non-null accessor, so no test opens with a null check that cannot fire. */
function api(): Harness {
  if (harness === null) throw new Error("harness not started");
  return harness;
}

after(async () => {
  if (!available) {
    await closePool();
    return;
  }
  await cleanupTestRows();
  await api().stop();
});

async function signup(email: string): Promise<AuthResponse> {
  const res = await call<ApiSuccess<AuthResponse>>(api(), "POST", "/api/auth/signup", {
    body: { email, password: PASSWORD, full_name: "Test Person" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

describe("A1.1 — signup and login", { skip: !available }, () => {
  test("the password is never stored in plaintext", async () => {
    const address = uniqueEmail("plaintext");
    await signup(address);

    const row = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      [address],
    );
    assert.ok(row, "user was not created");
    assert.notEqual(row.password_hash, PASSWORD);
    assert.equal(row.password_hash.includes(PASSWORD), false);
    assert.match(row.password_hash, /^\$argon2id\$/);
  });

  test("the session token is never stored either — only its hash", async () => {
    const address = uniqueEmail("tokenhash");
    const auth = await signup(address);

    const stored = await queryOne<{ token_hash: string }>(
      "SELECT token_hash FROM sessions WHERE token_hash = $1",
      [hashToken(auth.token)],
    );
    assert.ok(stored, "session was not created under the hashed token");

    // The plaintext token appears nowhere in the table.
    const leaked = await queryOne<{ id: Id }>(
      "SELECT id FROM sessions WHERE token_hash = $1",
      [auth.token],
    );
    assert.equal(leaked, null);
  });

  test("sign up, log out, log back in", async () => {
    const address = uniqueEmail("roundtrip");
    const first = await signup(address);

    const out = await call(api(), "POST", "/api/auth/logout", { token: first.token });
    assert.equal(out.status, 204);

    // Revoked immediately — the thing a JWT cannot do (TRD.md §1).
    const afterLogout = await call(api(), "GET", "/api/auth/me", { token: first.token });
    assert.equal(afterLogout.status, 401);

    const second = await call<ApiSuccess<AuthResponse>>(api(), "POST", "/api/auth/login", {
      body: { email: address, password: PASSWORD },
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.user.email, address);
  });

  test("a new account is a rep, whatever the body asks for", async () => {
    const address = uniqueEmail("massassign");
    const res = await call<ApiError>(api(), "POST", "/api/auth/signup", {
      body: { email: address, password: PASSWORD, full_name: "Sneaky", role: "admin" },
    });
    // Not filtered out — rejected by name, so the probe is visible (TRD.md §3).
    assert.equal(res.status, 400);
    assert.match(res.body.error.fields?.role ?? "", /not a field/);

    // And the plain signup path still produces a rep.
    const auth = await signup(uniqueEmail("defaultrole"));
    assert.equal(auth.user.role, "rep");
  });

  test("a wrong password and an unknown address give the same answer", async () => {
    const address = uniqueEmail("enumeration");
    await signup(address);

    const wrongPassword = await call<ApiError>(api(), "POST", "/api/auth/login", {
      body: { email: address, password: "definitely-not-the-password" },
    });
    const unknownAddress = await call<ApiError>(api(), "POST", "/api/auth/login", {
      body: { email: uniqueEmail("nobody"), password: PASSWORD },
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownAddress.status, 401);
    // Identical, so the response is not an account-enumeration oracle.
    assert.deepEqual(wrongPassword.body.error, unknownAddress.body.error);
  });

  test("a short password is refused with a message naming the field", async () => {
    const res = await call<ApiError>(api(), "POST", "/api/auth/signup", {
      body: { email: uniqueEmail("short"), password: "short", full_name: "Test" },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.fields?.password);
  });
});

describe("PS §7 — the two realms are disjoint", { skip: !available }, () => {
  /** Builds a real portal session, the way redemption will in slice 7. */
  async function createPortalSession(): Promise<string> {
    const tier = await queryOne<{ id: Id }>(
      `INSERT INTO customer_tiers (name, max_discount_pct, sort_order)
       VALUES ($1, 10, 99) RETURNING id`,
      [`TEST tier ${Date.now()}`],
    );
    assert.ok(tier);
    const customer = await queryOne<{ id: Id }>(
      "INSERT INTO customers (name, tier_id) VALUES ($1, $2) RETURNING id",
      [`TEST Customer ${Date.now()}`, tier.id],
    );
    assert.ok(customer);
    const contact = await queryOne<{ id: Id }>(
      "INSERT INTO contacts (customer_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
      [customer.id, uniqueEmail("portal"), "Portal Person"],
    );
    assert.ok(contact);

    const token = generateToken();
    await query(
      `INSERT INTO portal_sessions (token_hash, contact_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
      [hashToken(token), contact.id, String(env.portalSessionTtlHours)],
    );
    return token;
  }

  test("a portal token is not a user with the wrong role — it is not a user", async () => {
    const portalToken = await createPortalSession();

    const res = await call<ApiError>(api(), "GET", "/api/auth/me", { token: portalToken });

    // 401, not 403. A 403 would mean the internal realm recognised the identity
    // and declined it; the point of two tables is that it cannot recognise it
    // at all (DB_SCHEMA.md §2).
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });

  test("an internal token does not resolve in the portal realm either", async () => {
    const auth = await signup(uniqueEmail("crossrealm"));
    const found = await queryOne<{ id: Id }>(
      "SELECT id FROM portal_sessions WHERE token_hash = $1",
      [hashToken(auth.token)],
    );
    assert.equal(found, null);
  });
});

describe("session handling", { skip: !available }, () => {
  test("a garbage token is a 401, not a 500", async () => {
    const res = await call<ApiError>(api(), "GET", "/api/auth/me", { token: "not-a-real-token" });
    assert.equal(res.status, 401);
  });

  test("no token at all is a 401", async () => {
    const res = await call<ApiError>(api(), "GET", "/api/auth/me");
    assert.equal(res.status, 401);
  });

  test("an expired session does not authenticate", async () => {
    const address = uniqueEmail("expired");
    const auth = await signup(address);
    await query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [
      hashToken(auth.token),
    ]);

    const res = await call<ApiError>(api(), "GET", "/api/auth/me", { token: auth.token });
    assert.equal(res.status, 401);
  });

  test("/auth/me returns the current user and no secret", async () => {
    const address = uniqueEmail("me");
    const auth = await signup(address);
    const res = await call<ApiSuccess<User>>(api(), "GET", "/api/auth/me", { token: auth.token });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, address);
    assert.equal("password_hash" in res.body.data, false);
  });
});

describe("error shape", { skip: !available }, () => {
  test("an unknown API path is a 404 in the API's own error shape", async () => {
    const res = await call<ApiError>(api(), "GET", "/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("a 500 would carry no stack — and malformed JSON is a 400, not a 500", async () => {
    const res = await fetch(`${api().url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ this is not json",
    });
    const body = (await res.json()) as ApiError;
    assert.equal(res.status, 400);
    assert.equal("stack" in body.error, false);
  });
});
