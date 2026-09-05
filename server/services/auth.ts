/**
 * Authentication policy. No HTTP here — no `req`, no `res`, no status codes
 * beyond the AppError vocabulary (TRD.md §2). What lives here is the set of
 * decisions: who may sign up, what a failed login is allowed to reveal, how
 * long a session lasts, and what gets stored when one is minted.
 */
import { env } from "../lib/env.ts";
import { burnPasswordTime, generateToken, hashPassword, hashToken, verifyPassword } from "../lib/crypto.ts";
import { businessRule, unauthenticated } from "../lib/errors.ts";
import * as users from "../repositories/users.ts";
import * as sessions from "../repositories/sessions.ts";
import type { AuthResponse, Id, User } from "../../shared/types.ts";

/**
 * The generic failure. Wrong password and unknown address return the SAME
 * message, for the same reason 404 never distinguishes absent from not-yours:
 * a login form that says "no such user" is an account-enumeration oracle.
 */
const BAD_CREDENTIALS = "Email or password is incorrect.";

function expiryFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/** Mints a session and returns the token — the only moment it exists in plaintext. */
async function mintInternalSession(
  user: User,
  userAgent: string | null,
): Promise<AuthResponse> {
  const token = generateToken();
  const expiresAt = expiryFromNow(env.sessionTtlHours);
  // Only the hash is stored. A database dump yields no usable credential.
  await sessions.createInternal({
    token_hash: hashToken(token),
    user_id: user.id,
    expires_at: expiresAt,
    user_agent: userAgent,
  });
  return { token, expires_at: expiresAt.toISOString(), user };
}

/**
 * A1.1. Role is NOT a parameter — every self-service signup is a rep. Promotion
 * is an admin action against an existing account, never a field in the body
 * that created it.
 */
export async function signup(
  input: { email: string; password: string; full_name: string },
  userAgent: string | null,
): Promise<AuthResponse> {
  if (await users.emailExists(input.email)) {
    // Signup is the one place enumeration cannot be avoided — the form has to
    // say the address is taken or the user cannot proceed. Stated as a known
    // limitation rather than pretended away.
    throw businessRule("An account with that email already exists.");
  }
  const user = await users.insert({
    email: input.email,
    password_hash: await hashPassword(input.password),
    full_name: input.full_name,
    role: "rep",
  });
  return mintInternalSession(user, userAgent);
}

export async function login(
  input: { email: string; password: string },
  userAgent: string | null,
): Promise<AuthResponse> {
  const found = await users.findByEmailWithSecret(input.email);

  if (found === null) {
    // Hash a throwaway password anyway, so an unknown address costs the same
    // wall-clock time as a known one and timing leaks nothing.
    await burnPasswordTime();
    throw unauthenticated(BAD_CREDENTIALS);
  }

  const passwordOk = await verifyPassword(found.password_hash, input.password);
  if (!passwordOk) throw unauthenticated(BAD_CREDENTIALS);

  // Checked after the password, on purpose: answering "that account is
  // disabled" before verifying the password would confirm the address exists
  // to someone who does not know the password.
  if (!found.is_active) throw unauthenticated(BAD_CREDENTIALS);

  const { password_hash: _discard, ...user } = found;
  return mintInternalSession(user, userAgent);
}

export async function logout(token: string): Promise<void> {
  await sessions.revokeInternal(hashToken(token));
}

/** Resolves a bearer token to a user, for `requireInternal`. */
export async function resolveInternalSession(token: string): Promise<User | null> {
  const userId = await sessions.findInternalUserId(hashToken(token));
  if (userId === null) return null;
  const user = await users.findById(userId);
  // A live session belonging to a deactivated account is not a session. The
  // check is here rather than in the SQL so deactivation takes effect on the
  // very next request without touching the sessions table.
  if (user === null || !user.is_active) return null;
  return user;
}

/** Resolves a bearer token to a contact and the one quotation it is scoped to. */
export async function resolvePortalSession(
  token: string,
): Promise<{ contact_id: Id; quotation_id: Id | null } | null> {
  return sessions.findPortalSession(hashToken(token));
}
