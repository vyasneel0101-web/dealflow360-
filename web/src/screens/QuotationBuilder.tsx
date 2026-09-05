import { useEffect, useRef, useState } from "react";
import type {
  Id,
  Paginated,
  Product,
  QuotationDetail,
  QuotationLine,
  RiskLineBreakdown,
} from "@shared/types";
import {
  Button,
  EmptyState,
  Field,
  LineStatusBadge,
  Money,
  Percent,
  QuotationStatusBadge,
  RiskBadge,
  SectionCard,
  Select,
  TextInput,
  useToast,
} from "@ui/index";
import { useApi, useDebounced } from "../lib/useApi";
import { api, ApiRequestError } from "../lib/api";
import { Link } from "../lib/router";
import { useAuth } from "../lib/auth";

/**
 * Screen 4 — the Quotation Builder. The screen the PS §10 story hangs on.
 *
 * ─── THE ONE THING THIS SCREEN GETS RIGHT ───────────────────────────────────
 *
 * The wireframe requires the discount to be "checked against each line's own
 * limit live, as soon as it is entered, not only at submit time". Every
 * mutation here returns the WHOLE recomputed quotation, so the Limit and Status
 * columns, the margin rail and the risk band are all rendered from what the
 * server just stored.
 *
 * Nothing on this screen is computed in the browser. A client-side ceiling
 * check would be a second implementation of the governance rule, and the two
 * would drift — which is precisely the bug that makes a compliance feature
 * worse than not having one.
 */
export function QuotationBuilder({ id }: { id: Id }) {
  const quote = useApi<QuotationDetail>(`/quotations/${id}`);
  const products = useApi<Paginated<Product>>("/products?limit=200");
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  /** Every mutation replaces the whole resource from its own response. */
  async function mutate(run: () => Promise<QuotationDetail>) {
    setBusy(true);
    try {
      quote.set(await run());
    } catch (error) {
      toast.show(
        error instanceof ApiRequestError ? error.message : "That change did not save.",
        "danger",
      );
      // Re-read, so the screen never shows a state the server did not accept.
      quote.reload();
    } finally {
      setBusy(false);
    }
  }

  if (quote.loading) {
    return (
      <div className="mx-auto max-w-page space-y-4 p-6">
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (quote.error || quote.data === null) {
    return (
      <div className="mx-auto max-w-page p-6">
        <div className="rounded-md border border-border bg-surface">
          <EmptyState
            title="Could not open this quotation"
            description={quote.error ?? "It may have been removed."}
            action={
              <Link to="/quotations" className="text-sm text-brand underline">
                Back to Quotations
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const q = quote.data;

  /**
   * Mirrors the server rule in services/quotations.ts: terms change only in an
   * open state, and only for the owner or a manager/admin. This is convenience,
   * never the boundary — the server refuses either way. But offering an input
   * that is guaranteed to fail is worse than not offering it: the rep types a
   * discount, watches nothing happen, and learns not to trust the screen.
   */
  const openStatus = ["draft", "returned", "negotiation"].includes(q.status);
  const mayEdit =
    user !== null &&
    (user.role === "manager" || user.role === "admin" || user.id === q.owner_user_id);
  const editable = openStatus && mayEdit;

  return (
    <div className="mx-auto max-w-page space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 text-xs text-text-muted">
            <Link to="/quotations" className="hover:text-text">
              Quotations
            </Link>{" "}
            / {q.ref}
          </div>
          <h1 className="text-xl font-semibold text-text">{q.customer.name}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {q.customer.tier_name} tier · ceiling{" "}
            <Percent value={q.customer.tier_max_discount_pct} /> ·{" "}
            {q.price_list ? q.price_list.name : "no price list"} · owned by {q.owner_name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <QuotationStatusBadge status={q.status} />
          <RiskBadge band={q.risk.band} />
        </div>
      </header>

      {!editable ? (
        <p className="rounded-md border border-border bg-bg p-3 text-sm text-text-muted">
          {!openStatus
            ? `This quotation is ${q.status.replace("_", " ")}. Its terms can no longer change.`
            : `This quotation belongs to ${q.owner_name}. You can read it, but not change its terms.`}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <SectionCard
            title="Lines"
            description="Discount is checked against each line's own limit as you type."
          >
            <LineTable
              quote={q}
              editable={editable && !busy}
              onUpdate={(lineId, body) =>
                mutate(() => api.patch<QuotationDetail>(`/quotations/${q.id}/lines/${lineId}`, body))
              }
              onRemove={(lineId) =>
                mutate(() => api.delete<QuotationDetail>(`/quotations/${q.id}/lines/${lineId}`))
              }
            />
          </SectionCard>

          {editable ? (
            <SectionCard title="Add a line">
              <AddLine
                products={(products.data?.items ?? []).filter((p) => p.archived_at === null)}
                busy={busy}
                onAdd={(body) =>
                  mutate(() => api.post<QuotationDetail>(`/quotations/${q.id}/lines`, body))
                }
              />
            </SectionCard>
          ) : null}
        </div>

        <RiskRail quote={q} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The line table — Discount / Limit / Status, live
// ─────────────────────────────────────────────────────────────────────────────

function LineTable({
  quote,
  editable,
  onUpdate,
  onRemove,
}: {
  quote: QuotationDetail;
  editable: boolean;
  onUpdate: (lineId: Id, body: { qty?: number; discount_pct?: number }) => void;
  onRemove: (lineId: Id) => void;
}) {
  if (quote.lines.length === 0) {
    return (
      <EmptyState
        title="No lines yet"
        description="Add a product below. Totals, margin and the risk band appear as soon as you do."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            <th className="px-2 py-2 text-left">Product</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Unit</th>
            <th className="px-2 py-2 text-right">Discount</th>
            <th className="px-2 py-2 text-right">Limit</th>
            <th className="px-2 py-2 text-left">Status</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              currency={quote.currency}
              editable={editable}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineRow({
  line,
  currency,
  editable,
  onUpdate,
  onRemove,
}: {
  line: QuotationLine;
  currency: QuotationDetail["currency"];
  editable: boolean;
  onUpdate: (lineId: Id, body: { qty?: number; discount_pct?: number }) => void;
  onRemove: (lineId: Id) => void;
}) {
  // Local draft state, so typing is not fought by the server's response. The
  // server stays the source of truth for ceiling, overage and totals; only the
  // raw input string is local.
  const [discount, setDiscount] = useState(String(line.discount_pct));
  const [qty, setQty] = useState(String(line.qty));

  // 300ms after the last keystroke, not on every one: "12.5" would otherwise
  // send four requests, each recomputing the whole quotation server-side.
  const settledDiscount = useDebounced(discount, 300);
  const settledQty = useDebounced(qty, 300);

  // Only a field the USER touched may send an update. Without this, the effect
  // fires on mount and on every server response, and the screen writes back
  // values it was just given.
  const touched = useRef<{ discount: boolean; qty: boolean }>({ discount: false, qty: false });

  useEffect(() => {
    if (!touched.current.discount) return;
    const value = Number(settledDiscount);
    // An out-of-range draft is left alone rather than snapped back mid-typing:
    // "1" on the way to "15" is briefly invalid for a field capped at 100 only
    // in the other direction, and yanking the value away is hostile.
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    if (value === line.discount_pct) return;
    onUpdate(line.id, { discount_pct: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledDiscount]);

  useEffect(() => {
    if (!touched.current.qty) return;
    const value = Number(settledQty);
    if (!Number.isInteger(value) || value < 1) return;
    if (value === line.qty) return;
    onUpdate(line.id, { qty: value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledQty]);

  // If the server reports a value we did not type — an order-level discount was
  // applied, or our own update landed — adopt it rather than showing a stale
  // draft.
  useEffect(() => {
    touched.current.discount = false;
    setDiscount(String(line.discount_pct));
  }, [line.discount_pct]);
  useEffect(() => {
    touched.current.qty = false;
    setQty(String(line.qty));
  }, [line.qty]);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-2 text-sm">
        <div className="font-medium text-text">{line.product_name}</div>
        <div className="text-xs text-text-muted">
          {line.category_name}
          {line.variant_label ? ` · ${line.variant_label}` : ""}
          {line.line_type === "recurring" ? ` · ${line.recurring_interval}` : ""}
        </div>
      </td>

      <td className="px-2 py-2 text-right">
        <NumberCell
          value={qty}
          disabled={!editable}
          onChange={(v) => {
            touched.current.qty = true;
            setQty(v);
          }}
          ariaLabel={`Quantity for ${line.product_name}`}
        />
      </td>

      <td className="px-2 py-2 text-right text-sm">
        <Money cents={line.unit_price_cents} currency={currency} />
      </td>

      <td className="px-2 py-2 text-right">
        <NumberCell
          value={discount}
          disabled={!editable}
          suffix="%"
          onChange={(v) => {
            touched.current.discount = true;
            setDiscount(v);
          }}
          ariaLabel={`Discount for ${line.product_name}`}
        />
      </td>

      {/* Limit and Status come from the server. The browser does not decide
          whether a line is over its ceiling. */}
      <td className="px-2 py-2 text-right text-sm text-text-muted">
        <Percent value={line.ceiling_pct} />
      </td>
      <td className="px-2 py-2">
        <LineStatusBadge overagePct={line.overage_pct} />
      </td>
      <td className="px-2 py-2 text-right text-sm">
        <Money cents={line.line_total_cents} currency={currency} />
      </td>
      <td className="px-2 py-2 text-right">
        {editable ? (
          <Button variant="ghost" onClick={() => onRemove(line.id)} aria-label="Remove line">
            Remove
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/** A bare numeric cell. The debounce that turns typing into requests lives in
 *  LineRow, so this stays a dumb input. */
function NumberCell({
  value,
  disabled,
  suffix,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled: boolean;
  suffix?: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <TextInput
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 text-right tabular"
      />
      {suffix ? <span className="text-xs text-text-muted">{suffix}</span> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The right-hand rail — margin and the risk summary
// ─────────────────────────────────────────────────────────────────────────────

function RiskRail({ quote }: { quote: QuotationDetail }) {
  const { totals, risk } = quote;
  const flagged = risk.lines.filter((l) => l.status === "over");

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <SectionCard title="Totals">
        <dl className="space-y-2 text-sm">
          <Row label="Subtotal">
            <Money cents={totals.subtotal_cents} currency={quote.currency} />
          </Row>
          <Row label="Discount">
            <Money cents={-totals.discount_cents} currency={quote.currency} />
          </Row>
          <Row label="Tax">
            <Money cents={totals.tax_cents} currency={quote.currency} />
          </Row>
          <div className="border-t border-border pt-2">
            <Row label="Total" strong>
              <Money cents={totals.total_cents} currency={quote.currency} />
            </Row>
          </div>
          {totals.recurring_total_cents > 0 ? (
            <p className="pt-1 text-xs text-text-muted">
              Includes <Money cents={totals.recurring_total_cents} currency={quote.currency} />{" "}
              recurring, billed separately.
            </p>
          ) : null}
        </dl>
      </SectionCard>

      <SectionCard title="Margin">
        <div
          className={`text-2xl font-semibold ${
            totals.margin_cents < 0 ? "text-danger" : "text-text"
          }`}
        >
          <Money cents={totals.margin_cents} currency={quote.currency} />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          <Percent value={totals.margin_pct} /> of revenue, after{" "}
          <Money cents={totals.cost_cents} currency={quote.currency} /> cost.
        </p>
      </SectionCard>

      <SectionCard title="Discount risk">
        <div className="flex items-center justify-between">
          <RiskBadge band={risk.band} />
          <span className="text-xs text-text-muted">
            {risk.required_levels.length === 0
              ? "No approval needed"
              : `Needs ${risk.required_levels.join(" then ")}`}
          </span>
        </div>

        {/* Both statistics, shown separately, because they answer two different
            questions and either can escalate on its own (PRD.md §6.1). */}
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Blended score">
            <span className="tabular">{risk.blended_score}</span>
          </Row>
          <Row label="Worst line">
            <span className="tabular">
              {risk.worst_line_overage === 0 ? "—" : `+${risk.worst_line_overage}pt`}
            </span>
          </Row>
        </dl>

        {risk.failed_closed ? (
          <p className="mt-3 rounded-sm bg-warn-subtle p-2 text-xs text-warn">
            Discount limits are not fully configured, so this quote was routed to the highest band.
          </p>
        ) : null}

        {flagged.length > 0 ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Why this is flagged
            </p>
            <ul className="mt-2 space-y-2">
              {flagged.map((line) => (
                <FlaggedLine key={line.line_id} line={line} />
              ))}
            </ul>
          </div>
        ) : quote.lines.length > 0 ? (
          <p className="mt-3 text-xs text-text-muted">
            Every line is inside its limit. This quote goes straight to fulfillment.
          </p>
        ) : null}
      </SectionCard>
    </aside>
  );
}

function FlaggedLine({ line }: { line: RiskLineBreakdown }) {
  return (
    <li className="text-xs">
      <div className="font-medium text-text">{line.label}</div>
      <div className="text-text-muted">
        <Percent value={line.discount_pct} /> against a{" "}
        <Percent value={line.ceiling_pct} /> limit — over by {line.overage_pct}pt, carrying{" "}
        {Math.round(line.value_weight * 100)}% of the order
      </div>
    </li>
  );
}

function Row({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-medium text-text" : "text-text-muted"}>{label}</dt>
      <dd className={strong ? "font-semibold text-text" : "text-text"}>{children}</dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a line
// ─────────────────────────────────────────────────────────────────────────────

function AddLine({
  products,
  busy,
  onAdd,
}: {
  products: Product[];
  busy: boolean;
  onAdd: (body: { product_id: Id; variant_id?: Id; qty: number; discount_pct: number }) => void;
}) {
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [discount, setDiscount] = useState("0");

  const product = products.find((p) => String(p.id) === productId);

  function submit() {
    if (!product) return;
    onAdd({
      product_id: product.id,
      ...(variantId ? { variant_id: Number(variantId) } : {}),
      qty: Math.max(1, Number(qty) || 1),
      discount_pct: Math.min(100, Math.max(0, Number(discount) || 0)),
    });
    setProductId("");
    setVariantId("");
    setQty("1");
    setDiscount("0");
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <Field label="Product" htmlFor="add-product">
          <Select
            id="add-product"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setVariantId("");
            }}
          >
            <option value="">Choose…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.category_name} (limit {p.category_max_discount_pct}%)
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {product && product.variants.length > 0 ? (
        <div className="min-w-[180px]">
          <Field label="Variant" htmlFor="add-variant">
            <Select
              id="add-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              <option value="">None</option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.attribute}: {v.values}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      <div className="w-24">
        <Field label="Qty" htmlFor="add-qty">
          <TextInput
            id="add-qty"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="text-right tabular"
          />
        </Field>
      </div>

      <div className="w-28">
        <Field label="Discount %" htmlFor="add-discount">
          <TextInput
            id="add-discount"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="text-right tabular"
          />
        </Field>
      </div>

      <Button
        variant="primary"
        loading={busy}
        disabled={!product}
        disabledReason="Choose a product first"
        onClick={submit}
      >
        Add Line
      </Button>
    </div>
  );
}
