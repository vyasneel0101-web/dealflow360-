/**
 * Parameterised SQL for quotations and their lines.
 */
import { query, queryOne, type Queryable } from "../lib/db.ts";
import type {
  ApprovalChainRule,
  Cents,
  CurrencyCode,
  Id,
  LineType,
  Percent,
  QuotationStatus,
  RecurringInterval,
  RiskBand,
} from "../../shared/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The routing table (A3.3) — rows, read fresh on every evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read on every risk evaluation rather than cached at boot. Screen 18 must be
 * able to change routing and have the next quotation route differently; a
 * process-lifetime cache would make "Save configuration" a lie until restart.
 */
export function listChainRules(client?: Queryable): Promise<ApprovalChainRule[]> {
  return query<ApprovalChainRule>(
    `SELECT band, min_blended_score, min_worst_line, required_levels
       FROM approval_chain_rules`,
    [],
    client,
  );
}

export function upsertChainRule(
  rule: ApprovalChainRule,
  client?: Queryable,
): Promise<ApprovalChainRule | null> {
  return queryOne<ApprovalChainRule>(
    `INSERT INTO approval_chain_rules (band, min_blended_score, min_worst_line, required_levels)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (band) DO UPDATE
       SET min_blended_score = EXCLUDED.min_blended_score,
           min_worst_line    = EXCLUDED.min_worst_line,
           required_levels   = EXCLUDED.required_levels
     RETURNING band, min_blended_score, min_worst_line, required_levels`,
    [rule.band, rule.min_blended_score, rule.min_worst_line, rule.required_levels],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotations
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotationRow {
  id: Id;
  ref: string;
  customer_id: Id;
  price_list_id: Id | null;
  owner_user_id: Id;
  owner_name: string;
  status: QuotationStatus;
  currency: CurrencyCode;
  requested_delivery_date: Date | null;
  promised_date: Date | null;
  negotiation_round: number;
  last_activity_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
  /** The customer's tier ceiling — the tier half of every per-line limit. */
  tier_max_discount_pct: Percent | null;
}

const QUOTATION_SELECT = `
  SELECT q.id, q.ref, q.customer_id, q.price_list_id, q.owner_user_id,
         u.full_name AS owner_name,
         q.status, q.currency, q.requested_delivery_date, q.promised_date,
         q.negotiation_round, q.last_activity_at, q.created_at, q.confirmed_at,
         t.max_discount_pct AS tier_max_discount_pct
    FROM quotations q
    JOIN users u          ON u.id = q.owner_user_id
    JOIN customers c      ON c.id = q.customer_id
    LEFT JOIN customer_tiers t ON t.id = c.tier_id
`;

export function findQuotation(id: Id, client?: Queryable): Promise<QuotationRow | null> {
  return queryOne<QuotationRow>(`${QUOTATION_SELECT} WHERE q.id = $1`, [id], client);
}

/**
 * `FOR UPDATE` on the quotation row. Every line mutation recomputes and rewrites
 * the cached score, so two concurrent edits to the same quotation must serialise
 * — otherwise the later write can persist a score computed from a stale set of
 * lines, and the deal routes on a number that was never true.
 */
export function lockQuotation(id: Id, client: Queryable): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>("SELECT id FROM quotations WHERE id = $1 FOR UPDATE", [id], client);
}

export interface QuotationListFilter {
  status?: QuotationStatus;
  owner_user_id?: Id;
  customer_id?: Id;
  q?: string;
  limit: number;
  offset: number;
}

export interface QuotationSummaryRow {
  id: Id;
  ref: string;
  customer_id: Id;
  customer_name: string;
  status: QuotationStatus;
  currency: CurrencyCode;
  total_cents: Cents;
  risk_band: RiskBand | null;
  owner_user_id: Id;
  owner_name: string;
  last_activity_at: Date;
  created_at: Date;
}

/**
 * The list total is computed in SQL from the stored line snapshots rather than
 * by loading every line into JS. Screen 3 lists many quotations; one aggregate
 * query beats N line fetches.
 */
export async function listQuotations(
  filter: QuotationListFilter,
  client?: Queryable,
): Promise<{ items: QuotationSummaryRow[]; total: number }> {
  const where = `
    WHERE ($1::text   IS NULL OR q.status = $1)
      AND ($2::bigint IS NULL OR q.owner_user_id = $2)
      AND ($3::bigint IS NULL OR q.customer_id = $3)
      AND ($4::text   IS NULL OR q.ref ILIKE '%' || $4 || '%'
                              OR c.name ILIKE '%' || $4 || '%')
  `;
  const params = [
    filter.status ?? null,
    filter.owner_user_id ?? null,
    filter.customer_id ?? null,
    filter.q ?? null,
  ];

  const items = await query<QuotationSummaryRow>(
    `SELECT q.id, q.ref, q.customer_id, c.name AS customer_name, q.status, q.currency,
            COALESCE((
              SELECT sum(round(l.unit_price_cents * l.qty * (1 - l.discount_pct / 100)))
                FROM quotation_lines l WHERE l.quotation_id = q.id
            ), 0)::bigint AS total_cents,
            q.risk_band, q.owner_user_id, u.full_name AS owner_name,
            q.last_activity_at, q.created_at
       FROM quotations q
       JOIN customers c ON c.id = q.customer_id
       JOIN users u     ON u.id = q.owner_user_id
       ${where}
      ORDER BY q.last_activity_at DESC
      LIMIT $5 OFFSET $6`,
    [...params, filter.limit, filter.offset],
    client,
  );

  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM quotations q
       JOIN customers c ON c.id = q.customer_id
       ${where}`,
    params,
    client,
  );

  return { items, total: totalRow?.total ?? 0 };
}

/**
 * `Q-1042`-style references. Derived from the identity column rather than a
 * separate counter, so two concurrent inserts cannot mint the same ref — the
 * UNIQUE constraint would reject one and the rep would see a spurious error.
 */
export async function insertQuotation(
  input: {
    customer_id: Id;
    price_list_id: Id | null;
    owner_user_id: Id;
    currency: CurrencyCode;
    requested_delivery_date: string | null;
  },
  client?: Queryable,
): Promise<Id> {
  const row = await queryOne<{ id: Id }>(
    `INSERT INTO quotations
       (ref, customer_id, price_list_id, owner_user_id, currency, requested_delivery_date)
     VALUES ('PENDING', $1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.customer_id,
      input.price_list_id,
      input.owner_user_id,
      input.currency,
      input.requested_delivery_date,
    ],
    client,
  );
  if (row === null) throw new Error("INSERT INTO quotations returned no id");

  // Q-1042 for id 42, matching the wireframe's sample references.
  await query("UPDATE quotations SET ref = $2 WHERE id = $1", [row.id, `Q-${1000 + row.id}`], client);
  return row.id;
}

export function updateQuotationFields(
  id: Id,
  input: {
    customer_id?: Id;
    price_list_id?: Id | null;
    requested_delivery_date?: string | null;
    status?: QuotationStatus;
  },
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    `UPDATE quotations
        SET customer_id             = COALESCE($2, customer_id),
            price_list_id           = COALESCE($3, price_list_id),
            requested_delivery_date = COALESCE($4, requested_delivery_date),
            status                  = COALESCE($5, status),
            last_activity_at        = now()
      WHERE id = $1
      RETURNING id`,
    [
      id,
      input.customer_id ?? null,
      input.price_list_id ?? null,
      input.requested_delivery_date ?? null,
      input.status ?? null,
    ],
    client,
  );
}

/** Writes the cached risk figures. Called only by services/quotations.ts, on
 *  every path that can change a line. */
export function writeRiskCache(
  id: Id,
  risk: { blended_score: number; worst_line_overage: number; band: RiskBand },
  client?: Queryable,
): Promise<unknown> {
  return query(
    `UPDATE quotations
        SET blended_score      = $2,
            worst_line_overage = $3,
            risk_band          = $4,
            last_activity_at   = now()
      WHERE id = $1`,
    [id, risk.blended_score, risk.worst_line_overage, risk.band],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines
// ─────────────────────────────────────────────────────────────────────────────

export interface LineRow {
  id: Id;
  quotation_id: Id;
  product_id: Id;
  product_name: string;
  category_name: string;
  /** The category half of the per-line ceiling. */
  category_max_discount_pct: Percent | null;
  variant_id: Id | null;
  variant_label: string | null;
  qty: number;
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  discount_pct: Percent;
  line_type: LineType;
  recurring_interval: RecurringInterval | null;
  ceiling_pct: Percent;
  overage_pct: Percent;
  sort_order: number;
  tax_pct: Percent;
}

export function listLines(quotationId: Id, client?: Queryable): Promise<LineRow[]> {
  return query<LineRow>(
    `SELECT l.id, l.quotation_id, l.product_id,
            p.name AS product_name,
            cat.name AS category_name,
            cat.max_discount_pct AS category_max_discount_pct,
            l.variant_id,
            CASE WHEN v.id IS NULL THEN NULL
                 ELSE v.attribute || ': ' || v.values END AS variant_label,
            l.qty, l.unit_price_cents, l.unit_cost_cents, l.discount_pct,
            l.line_type, l.recurring_interval, l.ceiling_pct, l.overage_pct,
            l.sort_order, p.tax_pct
       FROM quotation_lines l
       JOIN products p                ON p.id = l.product_id
       LEFT JOIN product_categories cat ON cat.id = p.category_id
       LEFT JOIN product_variants v   ON v.id = l.variant_id
      WHERE l.quotation_id = $1
      ORDER BY l.sort_order, l.id`,
    [quotationId],
    client,
  );
}

export async function insertLine(
  input: {
    quotation_id: Id;
    product_id: Id;
    variant_id: Id | null;
    qty: number;
    unit_price_cents: Cents;
    unit_cost_cents: Cents;
    discount_pct: Percent;
    line_type: LineType;
    recurring_interval: RecurringInterval | null;
  },
  client?: Queryable,
): Promise<Id> {
  const row = await queryOne<{ id: Id }>(
    `INSERT INTO quotation_lines
       (quotation_id, product_id, variant_id, qty, unit_price_cents, unit_cost_cents,
        discount_pct, line_type, recurring_interval, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE((SELECT max(sort_order) + 1 FROM quotation_lines WHERE quotation_id = $1), 0))
     RETURNING id`,
    [
      input.quotation_id,
      input.product_id,
      input.variant_id,
      input.qty,
      input.unit_price_cents,
      input.unit_cost_cents,
      input.discount_pct,
      input.line_type,
      input.recurring_interval,
    ],
    client,
  );
  if (row === null) throw new Error("INSERT INTO quotation_lines returned no id");
  return row.id;
}

/** Scoped by quotation_id as well as line id — a mismatched pair is a 404, not
 *  a cross-quotation edit. */
export function updateLine(
  quotationId: Id,
  lineId: Id,
  input: { qty?: number; discount_pct?: Percent },
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    `UPDATE quotation_lines
        SET qty          = COALESCE($3, qty),
            discount_pct = COALESCE($4, discount_pct)
      WHERE id = $2 AND quotation_id = $1
      RETURNING id`,
    [quotationId, lineId, input.qty ?? null, input.discount_pct ?? null],
    client,
  );
}

export function deleteLine(
  quotationId: Id,
  lineId: Id,
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    "DELETE FROM quotation_lines WHERE id = $1 AND quotation_id = $2 RETURNING id",
    [lineId, quotationId],
    client,
  );
}

/** Writes the per-line ceiling and overage the risk engine just computed, so
 *  screen 4's Limit/Status columns render stored facts (DB_SCHEMA.md §5). */
export async function writeLineRisk(
  lines: { line_id: Id; ceiling_pct: Percent; overage_pct: Percent }[],
  client?: Queryable,
): Promise<void> {
  if (lines.length === 0) return;
  // One statement with unnest, rather than one UPDATE per line — a 40-line
  // quotation would otherwise be 40 round trips on every keystroke.
  await query(
    `UPDATE quotation_lines l
        SET ceiling_pct = u.ceiling, overage_pct = u.overage
       FROM unnest($1::bigint[], $2::numeric[], $3::numeric[]) AS u(id, ceiling, overage)
      WHERE l.id = u.id`,
    [
      lines.map((l) => l.line_id),
      lines.map((l) => l.ceiling_pct),
      lines.map((l) => l.overage_pct),
    ],
    client,
  );
}
