/**
 * The validator is the only thing standing between a request body and a service
 * call, so its four claimed properties (TRD.md §6) are tested as properties,
 * not as a sample of happy paths.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  array,
  bool,
  date,
  decimal,
  email,
  int,
  object,
  oneOf,
  string,
} from "../server/lib/validate.ts";

describe("whitelist, not blacklist", () => {
  const Signup = object({
    email: email({ required: true }),
    password: string({ min: 12, required: true }),
  });

  test("rejects a field the endpoint does not declare", () => {
    const result = Signup.parse({
      email: "a@b.com",
      password: "correct horse battery",
      role: "admin",
    });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false);
    // Named, not silently dropped — so a privilege probe is visible in the logs.
    assert.match(result.errors.role ?? "", /not a field/);
  });

  test("mass assignment is impossible even when the value is plausible", () => {
    const result = Signup.parse({
      email: "a@b.com",
      password: "correct horse battery",
      is_active: true,
    });
    assert.equal(result.ok, false);
  });
});

describe("coerce then validate", () => {
  test("int parses a query-string number", () => {
    const result = int({ min: 1 }).parse("42");
    assert.deepEqual(result, { ok: true, value: 42 });
  });

  test("int refuses NaN rather than passing it through", () => {
    // This is the parseInt-without-a-NaN-check bug, closed in one place.
    assert.equal(int().parse("not a number").ok, false);
    assert.equal(int().parse("").ok, false);
  });

  test("int refuses a fractional value", () => {
    assert.equal(int().parse("3.5").ok, false);
  });

  test("bool accepts the text a checkbox or query string sends", () => {
    assert.deepEqual(bool().parse("true"), { ok: true, value: true });
    assert.deepEqual(bool().parse("false"), { ok: true, value: false });
    assert.equal(bool().parse("yes").ok, false);
  });
});

describe("collect all errors", () => {
  test("reports every invalid field at once", () => {
    const Line = object({
      qty: int({ min: 1, required: true }),
      discount_pct: decimal({ min: 0, max: 100, required: true }),
    });
    const result = Line.parse({ qty: 0, discount_pct: 250 });
    assert.ok(result.ok === false);
    // One round trip marks both fields, rather than one field per round trip.
    assert.deepEqual(Object.keys(result.errors).sort(), ["discount_pct", "qty"]);
  });

  test("nested errors carry the path the UI needs to mark the field", () => {
    const Body = object({
      lines: array(object({ qty: int({ min: 1, required: true }) }), { required: true }),
    });
    const result = Body.parse({ lines: [{ qty: 5 }, { qty: 0 }] });
    assert.ok(result.ok === false);
    assert.ok("lines[1].qty" in result.errors, JSON.stringify(result.errors));
  });
});

describe("bounded by default", () => {
  test("a string has a maximum length nobody had to remember to set", () => {
    assert.equal(string().parse("x".repeat(1001)).ok, false);
    assert.equal(string().parse("x".repeat(1000)).ok, true);
  });

  test("an array has a maximum size nobody had to remember to set", () => {
    assert.equal(array(int()).parse(new Array(201).fill(1)).ok, false);
  });
});

describe("scalars", () => {
  test("decimal enforces scale rather than rounding silently", () => {
    // NUMERIC(6,3) in the database; accepting more precision would store a
    // value that no longer matches what the user was shown.
    assert.equal(decimal({ scale: 3 }).parse(12.3456).ok, false);
    assert.equal(decimal({ scale: 3 }).parse(12.345).ok, true);
  });

  test("oneOf refuses a state the CHECK constraint would reject", () => {
    const rule = oneOf(["low", "medium", "high"] as const);
    assert.deepEqual(rule.parse("high"), { ok: true, value: "high" });
    assert.equal(rule.parse("critical").ok, false);
  });

  test("date refuses a day that does not exist", () => {
    // Date would roll 2026-02-31 forward to March silently.
    assert.equal(date().parse("2026-02-31").ok, false);
    assert.deepEqual(date().parse("2026-09-05"), { ok: true, value: "2026-09-05" });
  });

  test("email is lowercased to match the CITEXT column", () => {
    assert.deepEqual(email().parse("  Bob@Example.COM "), { ok: true, value: "bob@example.com" });
    assert.equal(email().parse("bob@example").ok, false);
  });
});

describe("required and absent", () => {
  const Patch = object({
    full_name: string({ min: 1, max: 120 }),
    email: email({ required: true }),
  });

  test("a missing required field is reported by name", () => {
    const result = Patch.parse({ full_name: "Ada" });
    assert.ok(result.ok === false);
    assert.equal(result.errors.email, "is required");
  });

  test("an absent optional field is omitted, not set to undefined", () => {
    const result = Patch.parse({ email: "ada@example.com" });
    assert.ok(result.ok === true);
    // A PATCH handler must be able to tell "not sent" from "sent as empty".
    assert.equal("full_name" in result.value, false);
  });

  test("an empty string counts as absent, as a blank form field means", () => {
    const result = Patch.parse({ email: "ada@example.com", full_name: "" });
    assert.ok(result.ok === true);
    assert.equal("full_name" in result.value, false);
  });
});
