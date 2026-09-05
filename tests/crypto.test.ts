/**
 * Password and token handling. These tests assert the POLICY — what is stored
 * and what is not — rather than re-testing Argon2 itself, which is a vetted
 * library and not ours to verify.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateToken, hashPassword, hashToken, safeEqual, verifyPassword } from "../server/lib/crypto.ts";

describe("passwords", () => {
  const PASSWORD = "correct horse battery staple";

  test("the hash contains no trace of the plaintext", async () => {
    const hash = await hashPassword(PASSWORD);
    assert.equal(hash.includes(PASSWORD), false);
    for (const word of PASSWORD.split(" ")) {
      assert.equal(hash.includes(word), false, `hash leaked "${word}"`);
    }
  });

  test("hashing is Argon2id at the OWASP baseline", async () => {
    const hash = await hashPassword(PASSWORD);
    // 19 MiB = 19456 KiB memory, 2 iterations, 1 lane.
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  test("the same password hashes differently every time", async () => {
    // A per-hash salt: two users with the same password must not be visibly
    // identical in a database dump.
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    assert.notEqual(a, b);
  });

  test("verify accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword(PASSWORD);
    assert.equal(await verifyPassword(hash, PASSWORD), true);
    assert.equal(await verifyPassword(hash, "correct horse battery stapl"), false);
  });

  test("a corrupted hash reads as a failed login, not a crash", async () => {
    // A 500 here would tell an attacker they had found something interesting.
    assert.equal(await verifyPassword("not-a-hash", PASSWORD), false);
    assert.equal(await verifyPassword("", PASSWORD), false);
  });
});

describe("session tokens", () => {
  test("a token is 32 bytes of CSPRNG output, URL-safe", () => {
    const token = generateToken();
    // base64url of 32 bytes: 43 characters, no padding, no + or /.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  test("tokens do not repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));
    assert.equal(tokens.size, 500);
  });

  test("what is stored is the hash, and it is not reversible to the token", () => {
    const token = generateToken();
    const stored = hashToken(token);
    assert.notEqual(stored, token);
    assert.equal(stored.includes(token), false);
    assert.match(stored, /^[0-9a-f]{64}$/);
  });

  test("the same token always hashes to the same value, so lookup works", () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
  });
});

describe("constant-time comparison", () => {
  test("equal strings compare equal", () => {
    assert.equal(safeEqual("abc123", "abc123"), true);
  });

  test("different strings compare unequal, including different lengths", () => {
    assert.equal(safeEqual("abc123", "abc124"), false);
    assert.equal(safeEqual("abc", "abc123"), false);
  });
});
