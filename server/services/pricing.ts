/**
 * Price resolution (A2.3, A2.5) — the single place a unit price is decided.
 *
 * THE THREE-STEP ORDER, most specific first (DB_SCHEMA.md §3):
 *
 *   1. `price_list_items` — an explicit per-product override on the customer's
 *      price list. A human said "this product costs this much on this list",
 *      and nothing computed should override a stated fact.
 *   2. `products.base_price_cents` with the price list's RULE applied — the
 *      formula case, "base minus 10 percent" (wireframe screen 17).
 *   3. `products.base_price_cents` alone, when there is no price list.
 *
 * Then, in every case, the variant's `extra_price_cents` is added. A variant is
 * a modifier on whatever the resolved price turned out to be, not a fourth
 * competing source — otherwise picking a colour could silently discard a
 * negotiated override.
 *
 * Implemented ONCE, here. If this logic lived in the quotation-line handler,
 * the upsell panel and the portal would each grow their own subtly different
 * copy, and a customer would see a different price than the rep quoted.
 */
import { queryOne, type Queryable } from "../lib/db.ts";
import { applyPercentOff, roundHalfUp } from "../lib/money.ts";
import { notFound } from "../lib/errors.ts";
import type { Cents, Id, ResolvedPrice } from "../../shared/types.ts";

interface PricingInputs {
  base_price_cents: Cents;
  cost_cents: Cents;
  archived_at: Date | null;
  variant_extra_cents: Cents;
  price_list_id: Id | null;
  rule_type: "none" | "percent_off" | "fixed" | null;
  rule_value: number | null;
  override_price_cents: Cents | null;
}

/**
 * One query rather than four sequential ones. Price resolution runs on every
 * keystroke behind screen 4's live discount column, so four round trips per
 * line would be felt.
 */
const INPUTS_SQL = `
  SELECT
    p.base_price_cents,
    p.cost_cents,
    p.archived_at,
    COALESCE(v.extra_price_cents, 0) AS variant_extra_cents,
    pl.id                            AS price_list_id,
    pl.rule_type,
    pl.rule_value,
    pli.price_cents                  AS override_price_cents
  FROM products p
  LEFT JOIN product_variants v
    ON v.id = $2 AND v.product_id = p.id
  LEFT JOIN price_lists pl
    ON pl.id = $3 AND pl.archived_at IS NULL
  LEFT JOIN price_list_items pli
    ON pli.price_list_id = pl.id AND pli.product_id = p.id
  WHERE p.id = $1
`;

export async function resolvePrice(
  input: { product_id: Id; variant_id?: Id | null; price_list_id?: Id | null },
  client?: Queryable,
): Promise<ResolvedPrice> {
  const row = await queryOne<PricingInputs>(
    INPUTS_SQL,
    [input.product_id, input.variant_id ?? null, input.price_list_id ?? null],
    client,
  );
  if (row === null) throw notFound("That product does not exist.");

  // An archived product may still be priced — historical quotation lines and
  // reorders reference it. Archiving stops it appearing in the picker (A2.4);
  // it is not a delete, and treating it as one would break old quotes.

  return priceFrom(row);
}

/** The arithmetic, separated from the I/O so it can be tested without a database. */
export function priceFrom(row: PricingInputs): ResolvedPrice {
  const variantExtra = row.variant_extra_cents;
  let source: ResolvedPrice["source"];
  let resolved: Cents;

  if (row.override_price_cents !== null) {
    // Step 1 — a stated price wins over any formula.
    source = "price_list_item";
    resolved = row.override_price_cents;
  } else if (row.price_list_id !== null && row.rule_type !== null && row.rule_type !== "none") {
    // Step 2 — the price list's formula.
    source = "price_list_rule";
    resolved = applyRule(row.base_price_cents, row.rule_type, row.rule_value ?? 0);
  } else {
    // Step 3 — no list, or a list that states no adjustment.
    source = "base_price";
    resolved = row.base_price_cents;
  }

  return {
    // A rule must never produce a negative price. Clamped rather than rejected,
    // because a 120%-off promotion is a configuration mistake, not a reason to
    // fail a quotation the rep is in the middle of building.
    unit_price_cents: Math.max(0, resolved + variantExtra),
    unit_cost_cents: row.cost_cents,
    source,
    base_price_cents: row.base_price_cents,
    variant_extra_cents: variantExtra,
    price_list_id: row.price_list_id,
  };
}

function applyRule(baseCents: Cents, ruleType: "percent_off" | "fixed", value: number): Cents {
  switch (ruleType) {
    case "percent_off":
      // Screen 17's "Price minus 10 percent base".
      return applyPercentOff(baseCents, value);
    case "fixed":
      // A flat price for the list, stated in the same major units the admin
      // typed on screen 17 — so the rule value is dollars, not cents.
      return roundHalfUp(value * 100);
  }
}

/**
 * The price list that applies to a customer, when a quotation does not name one
 * explicitly: the list bound to the customer's tier. Returns null when the tier
 * has no list, which resolves to base price — step 3.
 */
export async function priceListForCustomer(
  customerId: Id,
  client?: Queryable,
): Promise<Id | null> {
  const row = await queryOne<{ id: Id }>(
    `SELECT pl.id
       FROM customers c
       JOIN price_lists pl ON pl.tier_id = c.tier_id AND pl.archived_at IS NULL
      WHERE c.id = $1
      ORDER BY pl.id
      LIMIT 1`,
    [customerId],
    client,
  );
  return row?.id ?? null;
}
