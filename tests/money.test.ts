/**
 * Money arithmetic. Small surface, but every invoice total in the system flows
 * through it, and a one-cent error is a disputed invoice.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  lineTotalCents,
  marginPct,
  roundHalfUp,
  roundPercent,
  taxCents,
} from "../server/lib/money.ts";

describe("integer cents, never floats", () => {
  test("the classic float error does not reach a total", () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In cents it is just 10 + 20 === 30.
    assert.equal(lineTotalCents(10, 1, 0) + lineTotalCents(20, 1, 0), 30);
  });

  test("a discount that lands on a half cent rounds half-up", () => {
    // 100 * 1 * (1 - 12.5/100) = 87.5 → 88, not 87.
    assert.equal(lineTotalCents(100, 1, 12.5), 88);
  });

  test("rounding is symmetric about zero", () => {
    // Credit notes and negative prorations are negative amounts and must round
    // the same way positive ones do; Math.round would send -0.5 to 0.
    assert.equal(roundHalfUp(-0.5), -1);
    assert.equal(roundHalfUp(0.5), 1);
  });
});

describe("line totals", () => {
  test("no discount is the plain product", () => {
    assert.equal(lineTotalCents(120_000, 3, 0), 360_000);
  });

  test("the PS §10 example line computes exactly", () => {
    // Laptop Pro 14 at $1,200, quantity 3, 12% off.
    assert.equal(lineTotalCents(120_000, 3, 12), 316_800);
  });

  test("a full discount is free, not negative", () => {
    assert.equal(lineTotalCents(45_000, 2, 100), 0);
  });
});

describe("derived figures", () => {
  test("tax rounds once, half-up", () => {
    assert.equal(taxCents(10_000, 7.5), 750);
    assert.equal(taxCents(101, 50), 51); // 50.5 → 51
  });

  test("margin on a zero-revenue line is 0, not NaN", () => {
    // A NaN here would propagate into every total on screen 4.
    assert.equal(marginPct(0, 0), 0);
    assert.equal(marginPct(0, 500), 0);
  });

  test("margin is a percentage of revenue", () => {
    assert.equal(marginPct(1000, 600), 40);
  });

  test("percentages keep NUMERIC(6,3) precision", () => {
    // Without this, a computed 4.999999999999999 fails a `>= 5` threshold that
    // the stored value passes — the same deal routing two different ways
    // depending on where the comparison ran.
    assert.equal(roundPercent(4.999999999999999), 5);
    assert.equal(roundPercent(8.0004), 8);
    assert.equal(roundPercent(8.0006), 8.001);
  });
});
