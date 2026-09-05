/**
 * Money and percentage arithmetic.
 *
 * One rule underneath all of it: money is an integer number of cents, always.
 * Floating-point currency arithmetic produces wrong invoices — 0.1 + 0.2 is not
 * 0.3, and an invoice that is one cent off is an invoice a customer disputes.
 *
 * Rounding happens ONCE, at the line total, half-up — the convention finance
 * expects. Rounding at each intermediate step compounds the error; rounding
 * later than the line total means a quotation's displayed total and the sum of
 * its displayed lines disagree, which reads as a bug even when the maths is right.
 */

/**
 * Half-up, and symmetric about zero: -0.5 rounds to -1, not to 0 as
 * `Math.round` would. Credit notes and negative prorations are negative
 * amounts, and they must round the same way positive ones do.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * The single place a line total is computed. Every caller — quotation lines,
 * invoice lines, proration — goes through here, so a change to rounding policy
 * is a change to one function.
 */
export function lineTotalCents(
  unitPriceCents: number,
  qty: number,
  discountPct: number,
): number {
  return roundHalfUp(unitPriceCents * qty * (1 - discountPct / 100));
}

/** List value before any discount — the weight denominator in the risk score. */
export function lineListValueCents(unitPriceCents: number, qty: number): number {
  return unitPriceCents * qty;
}

export function applyPercentOff(amountCents: number, percentOff: number): number {
  return roundHalfUp(amountCents * (1 - percentOff / 100));
}

export function taxCents(amountCents: number, taxPct: number): number {
  return roundHalfUp((amountCents * taxPct) / 100);
}

/**
 * Margin as a percentage of revenue. Returns 0 for a zero-revenue line rather
 * than NaN or Infinity: a free line has no margin to speak of, and a NaN would
 * propagate into every total on screen 4.
 */
export function marginPct(revenueCents: number, costCents: number): number {
  if (revenueCents === 0) return 0;
  return ((revenueCents - costCents) / revenueCents) * 100;
}

/**
 * Percentages are NUMERIC(6,3) in the database. Keeping the same precision in
 * JS stops a computed score of 4.999999999999999 from failing a `>= 5`
 * threshold that the stored value would have passed — which would mean a deal
 * routing differently depending on where the comparison ran.
 */
export function roundPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Display only. Every wire format uses integer cents (shared/types.ts). */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
