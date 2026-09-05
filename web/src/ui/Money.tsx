import type { Cents, CurrencyCode, Percent as Pct } from "@shared/types";

const SYMBOL: Record<CurrencyCode, string> = { USD: "$", EUR: "€" };

/**
 * Renders from integer minor units. The UI never sees a float, matching
 * DB_SCHEMA.md section 0. Every money cell is `tabular` so digits align
 * down a column.
 */
export function Money({
  cents,
  currency = "USD",
  signed = false,
  className = "",
}: {
  cents: Cents;
  currency?: CurrencyCode;
  signed?: boolean;
  className?: string;
}) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const sign = negative ? "-" : signed ? "+" : "";
  return (
    <span className={`tabular ${className}`}>{`${sign}${SYMBOL[currency]}${whole}.${frac}`}</span>
  );
}

/** 18 means 18%. Trailing zeros trimmed so a table of whole percents stays calm. */
export function Percent({ value, className = "" }: { value: Pct; className?: string }) {
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return <span className={`tabular ${className}`}>{text}%</span>;
}
