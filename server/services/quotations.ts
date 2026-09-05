/**
 * Quotation assembly and mutation.
 *
 * ─── THE ONE RULE THIS FILE EXISTS TO ENFORCE ───────────────────────────────
 *
 * Every mutation goes through `recomputeAndLoad`. Add a line, change a
 * quantity, change a discount, delete a line, apply an order discount, confirm
 * from the portal — all of them recompute risk from the lines, persist the
 * per-line ceiling and overage, rewrite the cached score, and return the WHOLE
 * quotation.
 *
 * Two consequences, both deliberate:
 *
 *   - The client never derives a governance figure. Screen 4's live
 *     Limit/Status columns are correct rather than approximately correct,
 *     because they are rendered from what the server just stored.
 *   - A customer-initiated change is governed identically to a rep-initiated
 *     one, because it is not a second code path. That is the whole
 *     implementation of B8.6.
 */
import { queryOne, withTransaction, type Queryable } from "../lib/db.ts";
import { businessRule, forbidden, notFound, stateConflict } from "../lib/errors.ts";
import { lineTotalCents, marginPct, taxCents } from "../lib/money.ts";
import * as repo from "../repositories/quotations.ts";
import * as catalogue from "../repositories/catalogue.ts";
import { resolvePrice, priceListForCustomer } from "./pricing.ts";
import { evaluateRisk, type RiskLineInput } from "./risk.ts";
import type {
  ApplyOrderDiscountRequest,
  CreateLineRequest,
  CreateQuotationRequest,
  Customer,
  Id,
  QuotationDetail,
  QuotationLine,
  QuotationTotals,
  Role,
  UpdateLineRequest,
  User,
} from "../../shared/types.ts";

/**
 * Statuses in which the terms may still change. A confirmed or rejected
 * quotation is a historical record; editing one would rewrite what was agreed
 * and make the audit trail a false account of the deal.
 */
const EDITABLE = new Set(["draft", "returned", "negotiation"]);

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a quotation and recomputes its risk for display. The evaluation is
 * cheap and pure, so recomputing on read guarantees the detail screen and the
 * stored cache can never disagree — if they ever did, the screen would be
 * explaining a band the deal was not actually routed on.
 */
export async function loadQuotation(id: Id, client?: Queryable): Promise<QuotationDetail> {
  const quotation = await repo.findQuotation(id, client);
  if (quotation === null) throw notFound("That quotation does not exist.");

  const [lineRows, rules, customer, priceList] = await Promise.all([
    repo.listLines(id, client),
    repo.listChainRules(client),
    loadCustomer(quotation.customer_id, client),
    quotation.price_list_id === null
      ? Promise.resolve(null)
      : catalogue.findPriceList(quotation.price_list_id, client),
  ]);

  const risk = evaluateRisk(toRiskInputs(lineRows, quotation.tier_max_discount_pct), rules);

  // Keyed by line id, not array position. The two happen to be built in the
  // same order today, but a breakdown attached to the wrong line would show a
  // rep the wrong reason for a flag, and index alignment is not a property
  // anything enforces.
  const breakdownById = new Map(risk.lines.map((l) => [l.line_id, l]));

  const lines: QuotationLine[] = lineRows.map((row) => {
    const breakdown = breakdownById.get(row.id);
    const total = lineTotalCents(row.unit_price_cents, row.qty, row.discount_pct);
    return {
      id: row.id,
      quotation_id: row.quotation_id,
      product_id: row.product_id,
      product_name: row.product_name,
      category_name: row.category_name,
      variant_id: row.variant_id,
      variant_label: row.variant_label,
      qty: row.qty,
      unit_price_cents: row.unit_price_cents,
      unit_cost_cents: row.unit_cost_cents,
      discount_pct: row.discount_pct,
      line_type: row.line_type,
      recurring_interval: row.recurring_interval,
      // From the evaluation just run, not from the stored column — they agree,
      // and where they could not, the freshly computed one is the truth.
      ceiling_pct: breakdown?.ceiling_pct ?? row.ceiling_pct,
      overage_pct: breakdown?.overage_pct ?? row.overage_pct,
      line_total_cents: total,
      line_margin_cents: total - row.unit_cost_cents * row.qty,
      sort_order: row.sort_order,
    };
  });

  return {
    id: quotation.id,
    ref: quotation.ref,
    customer,
    price_list: priceList,
    status: quotation.status,
    currency: quotation.currency,
    owner_user_id: quotation.owner_user_id,
    owner_name: quotation.owner_name,
    requested_delivery_date: quotation.requested_delivery_date?.toISOString().slice(0, 10) ?? null,
    promised_date: quotation.promised_date?.toISOString().slice(0, 10) ?? null,
    negotiation_round: quotation.negotiation_round,
    lines,
    totals: totalsFor(lines, lineRows),
    risk,
    last_activity_at: quotation.last_activity_at.toISOString(),
    created_at: quotation.created_at.toISOString(),
    confirmed_at: quotation.confirmed_at?.toISOString() ?? null,
  };
}

export async function listQuotations(filter: repo.QuotationListFilter) {
  const { items, total } = await repo.listQuotations(filter);
  return {
    items: items.map((row) => ({
      ...row,
      last_activity_at: row.last_activity_at.toISOString(),
      created_at: row.created_at.toISOString(),
    })),
    total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The recompute pipeline — every mutation ends here
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-evaluates risk from the current lines, persists the per-line ceiling and
 * overage plus the cached score, and returns the whole quotation.
 *
 * Runs inside the caller's transaction, so a mutation and the risk figures it
 * produced commit together. A crash between the two would otherwise leave a
 * quotation whose stored band was computed from lines that no longer exist.
 */
async function recomputeAndLoad(id: Id, client: Queryable): Promise<QuotationDetail> {
  const quotation = await repo.findQuotation(id, client);
  if (quotation === null) throw notFound("That quotation does not exist.");

  const [lineRows, rules] = await Promise.all([
    repo.listLines(id, client),
    repo.listChainRules(client),
  ]);

  const risk = evaluateRisk(toRiskInputs(lineRows, quotation.tier_max_discount_pct), rules);

  await repo.writeLineRisk(
    risk.lines.map((l) => ({
      line_id: l.line_id,
      ceiling_pct: l.ceiling_pct,
      overage_pct: l.overage_pct,
    })),
    client,
  );
  await repo.writeRiskCache(
    id,
    {
      blended_score: risk.blended_score,
      worst_line_overage: risk.worst_line_overage,
      band: risk.band,
    },
    client,
  );

  return loadQuotation(id, client);
}

function toRiskInputs(
  lines: repo.LineRow[],
  tierCeiling: number | null,
): RiskLineInput[] {
  return lines.map((row) => ({
    line_id: row.id,
    label: `${row.product_name} (${row.category_name})`,
    discount_pct: row.discount_pct,
    tier_ceiling_pct: tierCeiling,
    category_ceiling_pct: row.category_max_discount_pct,
    // List value, BEFORE discount. Weighting by the discounted value would let
    // a deeper discount shrink its own weight — the more margin a rep gave
    // away on a line, the less that line would count toward the score.
    list_value_cents: row.unit_price_cents * row.qty,
  }));
}

function totalsFor(lines: QuotationLine[], rows: repo.LineRow[]): QuotationTotals {
  let subtotal = 0;
  let total = 0;
  let cost = 0;
  let tax = 0;
  let oneTime = 0;
  let recurring = 0;

  lines.forEach((line, index) => {
    const listValue = line.unit_price_cents * line.qty;
    subtotal += listValue;
    total += line.line_total_cents;
    cost += line.unit_cost_cents * line.qty;
    tax += taxCents(line.line_total_cents, rows[index]?.tax_pct ?? 0);
    if (line.line_type === "recurring") recurring += line.line_total_cents;
    else oneTime += line.line_total_cents;
  });

  return {
    subtotal_cents: subtotal,
    discount_cents: subtotal - total,
    tax_cents: tax,
    total_cents: total,
    cost_cents: cost,
    margin_cents: total - cost,
    margin_pct: Math.round(marginPct(total, cost) * 100) / 100,
    one_time_total_cents: oneTime,
    recurring_total_cents: recurring,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function createQuotation(
  input: CreateQuotationRequest,
  owner: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    const customer = await loadCustomer(input.customer_id, client);

    // Default to the price list bound to the customer's tier, so a rep who
    // does not pick one still gets tier pricing rather than list price.
    const priceListId =
      input.price_list_id ?? (await priceListForCustomer(input.customer_id, client));

    const id = await repo.insertQuotation(
      {
        customer_id: input.customer_id,
        price_list_id: priceListId,
        owner_user_id: owner.id,
        currency: customer.currency,
        requested_delivery_date: input.requested_delivery_date ?? null,
      },
      client,
    );
    return recomputeAndLoad(id, client);
  });
}

export async function addLine(
  quotationId: Id,
  input: CreateLineRequest,
  actor: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    const quotation = await loadEditable(quotationId, actor, client);

    const product = await catalogue.findProduct(input.product_id, client);
    if (product === null) throw businessRule("That product does not exist.");
    if (product.archived_at !== null) {
      // Archived means "no longer sold", so it must not enter a NEW quote —
      // while remaining readable on the historical ones that reference it.
      throw businessRule(`${product.name} is archived and cannot be added.`);
    }

    // Price is resolved ONCE here and snapshotted onto the line. From this
    // moment the line's value is independent of the catalogue (DB_SCHEMA.md §5).
    const price = await resolvePrice(
      {
        product_id: input.product_id,
        variant_id: input.variant_id ?? null,
        price_list_id: quotation.price_list_id,
      },
      client,
    );

    await repo.insertLine(
      {
        quotation_id: quotationId,
        product_id: input.product_id,
        variant_id: input.variant_id ?? null,
        qty: input.qty,
        unit_price_cents: price.unit_price_cents,
        unit_cost_cents: price.unit_cost_cents,
        discount_pct: input.discount_pct,
        line_type: product.is_subscription ? "recurring" : "one_time",
        recurring_interval: product.recurring_interval,
      },
      client,
    );

    return recomputeAndLoad(quotationId, client);
  });
}

export async function updateLine(
  quotationId: Id,
  lineId: Id,
  input: UpdateLineRequest,
  actor: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    await loadEditable(quotationId, actor, client);
    const updated = await repo.updateLine(quotationId, lineId, input, client);
    if (updated === null) throw notFound("That line does not exist.");
    return recomputeAndLoad(quotationId, client);
  });
}

export async function removeLine(
  quotationId: Id,
  lineId: Id,
  actor: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    await loadEditable(quotationId, actor, client);
    const deleted = await repo.deleteLine(quotationId, lineId, client);
    if (deleted === null) throw notFound("That line does not exist.");
    return recomputeAndLoad(quotationId, client);
  });
}

/**
 * B3.3 — an order-level discount, applied across every line. Written to each
 * line rather than held as an order-level field, because the risk engine scores
 * lines: an order discount that lived outside them would be invisible to
 * governance, which is exactly the hole PS §10 describes.
 */
export async function applyOrderDiscount(
  quotationId: Id,
  input: ApplyOrderDiscountRequest,
  actor: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    await loadEditable(quotationId, actor, client);
    const lines = await repo.listLines(quotationId, client);
    for (const line of lines) {
      await repo.updateLine(quotationId, line.id, { discount_pct: input.discount_pct }, client);
    }
    return recomputeAndLoad(quotationId, client);
  });
}

export async function updateQuotation(
  quotationId: Id,
  input: { customer_id?: Id; price_list_id?: Id; requested_delivery_date?: string },
  actor: User,
): Promise<QuotationDetail> {
  return withTransaction(async (client) => {
    await loadEditable(quotationId, actor, client);
    const updated = await repo.updateQuotationFields(quotationId, input, client);
    if (updated === null) throw notFound("That quotation does not exist.");
    // Changing the customer changes the tier ceiling, and changing the price
    // list changes nothing already snapshotted — but the risk band must be
    // re-derived either way, which recomputeAndLoad does unconditionally.
    return recomputeAndLoad(quotationId, client);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locks the quotation, checks it is still editable, and checks this user may
 * edit it. Called by every mutation, so none of the three can be forgotten.
 */
async function loadEditable(
  id: Id,
  actor: User,
  client: Queryable,
): Promise<repo.QuotationRow> {
  await repo.lockQuotation(id, client);
  const quotation = await repo.findQuotation(id, client);
  if (quotation === null) throw notFound("That quotation does not exist.");

  assertMayEdit(quotation, actor);

  if (!EDITABLE.has(quotation.status)) {
    throw stateConflict(
      `This quotation is ${quotation.status.replace("_", " ")} and its terms can no longer change.`,
    );
  }
  return quotation;
}

/** PRD §3: a rep edits their own; managers and admins edit any. */
function assertMayEdit(quotation: repo.QuotationRow, actor: User): void {
  const privileged: Role[] = ["manager", "admin"];
  if (privileged.includes(actor.role)) return;
  if (actor.role === "rep" && quotation.owner_user_id === actor.id) return;
  throw forbidden("This quotation belongs to another rep.");
}

async function loadCustomer(id: Id, client?: Queryable): Promise<Customer> {
  const row = await queryOne<Customer & { archived_at: Date | null }>(
    `SELECT c.id, c.name, c.tier_id, t.name AS tier_name,
            t.max_discount_pct AS tier_max_discount_pct,
            c.email, c.currency, c.archived_at
       FROM customers c
       JOIN customer_tiers t ON t.id = c.tier_id
      WHERE c.id = $1`,
    [id],
    client,
  );
  if (row === null) throw businessRule("That customer does not exist.");
  return { ...row, archived_at: row.archived_at?.toISOString() ?? null };
}
