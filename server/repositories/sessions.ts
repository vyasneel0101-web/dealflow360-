/**
 * The two session realms, side by side in one file so the symmetry — and the
 * fact that they never share a query — is visible in one screen.
 *
 * `sessions` and `portal_sessions` are separate tables with separate functions.
 * There is no parameterised "which table" argument, because that parameter is
 * precisely the thing that could be wrong (DB_SCHEMA.md §2).
 */
import { query, queryOne, type Queryable } from "../lib/db.ts";
import type { Id } from "../../shared/types.ts";

/** The liveness predicate, written once and reused by both realms. */
const LIVE = "token_hash = $1 AND revoked_at IS NULL AND expires_at > now()";

// ─────────────────────────────────────────────────────────────────────────────
// Internal realm
// ─────────────────────────────────────────────────────────────────────────────

export async function createInternal(
  input: { token_hash: string; user_id: Id; expires_at: Date; user_agent: string | null },
  client?: Queryable,
): Promise<void> {
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [input.token_hash, input.user_id, input.expires_at, input.user_agent],
    client,
  );
}

/** Returns the user id behind a live internal token, or null. */
export async function findInternalUserId(
  tokenHash: string,
  client?: Queryable,
): Promise<Id | null> {
  const row = await queryOne<{ user_id: Id }>(
    `SELECT user_id FROM sessions WHERE ${LIVE}`,
    [tokenHash],
    client,
  );
  return row?.user_id ?? null;
}

/** Logout. Setting `revoked_at` kills the session on the next request — the
 *  thing a JWT cannot do without building this table anyway (TRD.md §1). */
export async function revokeInternal(tokenHash: string, client?: Queryable): Promise<void> {
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal realm — deliberately not the functions above with a flag
// ─────────────────────────────────────────────────────────────────────────────

export async function createPortal(
  input: {
    token_hash: string;
    contact_id: Id;
    quotation_id: Id | null;
    expires_at: Date;
    user_agent: string | null;
  },
  client?: Queryable,
): Promise<void> {
  await query(
    `INSERT INTO portal_sessions (token_hash, contact_id, quotation_id, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.token_hash,
      input.contact_id,
      input.quotation_id,
      input.expires_at,
      input.user_agent,
    ],
    client,
  );
}

/**
 * Returns the contact AND the quotation the session is scoped to. Both come
 * from the session, never from the request — which is what makes
 * `GET /portal/quotation` able to take no identifier at all (TRD.md §4).
 */
export async function findPortalSession(
  tokenHash: string,
  client?: Queryable,
): Promise<{ contact_id: Id; quotation_id: Id | null } | null> {
  return queryOne<{ contact_id: Id; quotation_id: Id | null }>(
    `SELECT contact_id, quotation_id FROM portal_sessions WHERE ${LIVE}`,
    [tokenHash],
    client,
  );
}

export async function revokePortal(tokenHash: string, client?: Queryable): Promise<void> {
  await query(
    "UPDATE portal_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash],
    client,
  );
}
