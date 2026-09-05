/**
 * The three-step price resolution (A2.3, A2.5).
 *
 * These test `priceFrom`, the pure arithmetic half, so the ORDER of the three
 * steps is pinned without a database. The order is the whole point: get it
 * wrong and picking a variant silently discards a negotiated override, or a
 * price list quietly overrides a price a human stated.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { priceFrom } from "../server/services/pricing.ts";

/** A product with no list, no variant, no override — the base case. */
const base = {
  base_price_cents: 120_000,
  cost_cents: 82_000,
  archived_at: null,
  variant_extra_cents: 0,
  price_list_id: null,
  rule_type: null,
  rule_value: null,
  override_price_cents: null,
} as const;

describe("step order, most specific first", () => {
  test("step 3 — no price list resolves to the base price", () => {
    const result = priceFrom({ ...base });
    assert.equal(result.unit_price_cents, 120_000);
    assert.equal(result.source, "base_price");
  });

  test("step 2 — a percent-off list applies its formula to the base price", () => {
    // Wireframe screen 17's "Price minus 10 percent base".
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      rule_type: "percent_off",
      rule_value: 10,
    });
    assert.equal(result.unit_price_cents, 108_000);
    assert.equal(result.source, "price_list_rule");
  });

  test("step 1 — an explicit override beats the list's formula", () => {
    // A human stated this price. Nothing computed should quietly replace it.
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      rule_type: "percent_off",
      rule_value: 10,
      override_price_cents: 104_000,
    });
    assert.equal(result.unit_price_cents, 104_000);
    assert.equal(result.source, "price_list_item");
  });

  test("a list with rule_type 'none' is not an override — it falls to base", () => {
    // Screen 17's "Price, no adjustment".
    const result = priceFrom({ ...base, price_list_id: 1, rule_type: "none", rule_value: 0 });
    assert.equal(result.unit_price_cents, 120_000);
    assert.equal(result.source, "base_price");
  });

  test("a fixed-price rule states the price in major units", () => {
    const result = priceFrom({ ...base, price_list_id: 1, rule_type: "fixed", rule_value: 999.5 });
    assert.equal(result.unit_price_cents, 99_950);
  });
});

describe("variants modify the resolved price, never replace it", () => {
  test("the variant extra is added on top of the base price", () => {
    const result = priceFrom({ ...base, variant_extra_cents: 15_000 });
    assert.equal(result.unit_price_cents, 135_000);
  });

  test("the variant extra is added on top of a LIST price, not the base", () => {
    // 120,000 - 10% = 108,000, then +15,000. If the variant were treated as a
    // fourth source the answer would be 135,000 and the price list would have
    // silently stopped applying.
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      rule_type: "percent_off",
      rule_value: 10,
      variant_extra_cents: 15_000,
    });
    assert.equal(result.unit_price_cents, 123_000);
  });

  test("the variant extra is added on top of an OVERRIDE", () => {
    // The failure this guards: choosing a colour discarding a negotiated price.
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      override_price_cents: 104_000,
      rule_type: "percent_off",
      rule_value: 10,
      variant_extra_cents: 15_000,
    });
    assert.equal(result.unit_price_cents, 119_000);
    assert.equal(result.source, "price_list_item");
  });
});

describe("degenerate configuration", () => {
  test("a rule over 100 percent clamps to free rather than going negative", () => {
    // A misconfigured promotion is a configuration mistake, not a reason to
    // fail a quotation the rep is halfway through building.
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      rule_type: "percent_off",
      rule_value: 120,
    });
    assert.equal(result.unit_price_cents, 0);
  });

  test("a negative variant extra cannot drag a price below zero", () => {
    const result = priceFrom({ ...base, base_price_cents: 1_000, variant_extra_cents: -5_000 });
    assert.equal(result.unit_price_cents, 0);
  });

  test("cost is carried through untouched by any pricing rule", () => {
    // Margin is computed from this. A discount changes what we charge, never
    // what the item cost us.
    const result = priceFrom({
      ...base,
      price_list_id: 1,
      rule_type: "percent_off",
      rule_value: 40,
    });
    assert.equal(result.unit_cost_cents, 82_000);
  });

  test("the resolution is reported, so the UI can explain the number", () => {
    const result = priceFrom({
      ...base,
      price_list_id: 7,
      rule_type: "percent_off",
      rule_value: 10,
      variant_extra_cents: 15_000,
    });
    assert.deepEqual(
      {
        source: result.source,
        base: result.base_price_cents,
        extra: result.variant_extra_cents,
        list: result.price_list_id,
      },
      { source: "price_list_rule", base: 120_000, extra: 15_000, list: 7 },
    );
  });
});
