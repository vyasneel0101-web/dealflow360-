/**
 * Password hashing and session-token handling.
 *
 * Nothing here is homemade cryptography. Argon2id comes from a vetted library
 * (the one thing the master prompt names outright as not-to-hand-roll); the
 * rest is Node's own `crypto`. What IS ours is the policy: which parameters,
 * what gets stored, and what never does.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/**
 * OWASP's recommended Argon2id baseline: 19 MiB of memory, two iterations,
 * one lane. Chosen over bcrypt for GPU-attack resistance — the memory cost is
 * what makes a rented GPU farm uneconomic rather than merely slow.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed hash. A corrupted row
 * should read as "these credentials do not work", not as a 500 that tells an
 * attacker they found something interesting.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

/**
 * A dummy verify for the login path, so a request for an address that does not
 * exist costs the same wall-clock time as one for an address that does.
 * Without it, response timing is a free account-enumeration oracle — the same
 * leak we close in the API by never distinguishing 404-absent from 404-not-yours.
 */
// Computed once, on first use, from the same parameters real passwords use —
// a hardcoded literal would be cheap to get subtly wrong, and a wrong one
// fails to verify instantly, which is the exact timing signal we are closing.
let dummyHash: Promise<string> | null = null;

export async function burnPasswordTime(): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, "not-a-real-password");
}

/**
 * 32 bytes of CSPRNG output, base64url so it survives a URL without escaping —
 * magic links carry one in a query string (TRD.md §3).
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What actually goes in the database. The token itself is never stored, so a
 * database dump yields no usable credential.
 *
 * SHA-256 rather than Argon2 here on purpose: a session token is 256 bits of
 * uniform randomness, not a guessable human secret, so there is nothing for a
 * slow hash to defend against — and session lookup happens on every single
 * request, where a 19 MiB hash would be a self-inflicted denial of service.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, for anywhere a secret is compared outside SQL. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Unequal lengths cannot be compared in constant time, and the length itself
  // is not the secret, so this early return leaks nothing that matters.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
