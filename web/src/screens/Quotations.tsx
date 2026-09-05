import { useMemo, useState } from "react";
import type { Customer, Id, Paginated, QuotationStatus, QuotationSummary } from "@shared/types";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  Money,
  PageHeader,
  QuotationStatusBadge,
  RiskBadge,
  Select,
  TextInput,
  useToast,
  type Column,
} from "@ui/index";
import { useApi } from "../lib/useApi";
import { api, ApiRequestError } from "../lib/api";
import { useRouter } from "../lib/router";
import { useAuth } from "../lib/auth";

/**
 * Screen 3 — Quotations.
 *
 * The wireframe draws this as cards grouped by stage with a "Switch to Table
 * View" button, which is how PS B1.1's "Pipeline (Kanban)" and B2.1's
 * "selectable cards" reconcile into ONE screen rather than two routes
 * (WIREFRAME_NOTES.md §3). Cards are the default; the table is the alternate.
 */

/** Stage order matches the deal's actual progression, left to right. */
const STAGES: { status: QuotationStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "pending_approval", label: "Pending Approval" },
  { status: "returned", label: "Returned" },
  { status: "approved", label: "Approved" },
  { status: "negotiation", label: "Negotiation" },
  { status: "confirmed", label: "Confirmed" },
];

type View = "cards" | "table";

export function Quotations() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [view, setView] = useState<View>("cards");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const query = new URLSearchParams({ limit: "200" });
  if (search.trim()) query.set("q", search.trim());
  if (mineOnly && user) query.set("owner", String(user.id));

  const quotes = useApi<Paginated<QuotationSummary>>(`/quotations?${query}`, [search, mineOnly]);
  const customers = useApi<Customer[]>("/customers");

  const grouped = useMemo(() => {
    const map = new Map<QuotationStatus, QuotationSummary[]>();
    for (const stage of STAGES) map.set(stage.status, []);
    for (const q of quotes.data?.items ?? []) {
      // `rejected` has no column in the wireframe; it lands under Returned so
      // a dead deal is still reachable rather than silently invisible.
      const key = q.status === "rejected" ? "returned" : q.status;
      map.get(key)?.push(q);
    }
    return map;
  }, [quotes.data]);

  async function createQuotation(customerId: Id) {
    setCreating(true);
    try {
      const created = await api.post<{ id: Id; ref: string }>("/quotations", {
        customer_id: customerId,
      });
      toast.show(`${created.ref} created`, "ok");
      navigate(`/quotations/${created.id}`);
    } catch (error) {
      toast.show(
        error instanceof ApiRequestError ? error.message : "Could not create the quotation.",
        "danger",
      );
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<QuotationSummary>[] = [
    { key: "ref", header: "Ref", render: (q) => <span className="font-medium">{q.ref}</span> },
    { key: "customer", header: "Customer", render: (q) => q.customer_name },
    { key: "owner", header: "Owner", render: (q) => q.owner_name, secondary: true },
    {
      key: "total",
      header: "Amount",
      align: "right",
      render: (q) => <Money cents={q.total_cents} currency={q.currency} />,
    },
    { key: "status", header: "Stage", render: (q) => <QuotationStatusBadge status={q.status} /> },
    { key: "risk", header: "Risk", render: (q) => <RiskBadge band={q.risk_band} /> },
  ];

  return (
    <div className="mx-auto max-w-page space-y-6 p-6">
      <PageHeader
        title="Quotations"
        description="Every active and draft deal. Click one to open the builder."
        actions={
          <>
            <Button onClick={() => setView(view === "cards" ? "table" : "cards")}>
              {view === "cards" ? "Switch to Table View" : "Switch to Card View"}
            </Button>
            <NewQuotation
              customers={customers.data ?? []}
              busy={creating}
              onCreate={createQuotation}
            />
          </>
        }
      />

      <FilterBar>
        <div className="min-w-[220px] flex-1">
          <Field label="Search" htmlFor="q-search">
            <TextInput
              id="q-search"
              value={search}
              placeholder="Reference or customer"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-text">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Only mine
        </label>
      </FilterBar>

      {quotes.error ? (
        <div className="rounded-md border border-danger bg-surface p-4 text-sm text-danger">
          {quotes.error}{" "}
          <button className="underline" onClick={quotes.reload}>
            Try again
          </button>
        </div>
      ) : null}

      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={quotes.data?.items ?? []}
          rowKey={(q) => q.id}
          onRowClick={(q) => navigate(`/quotations/${q.id}`)}
          loading={quotes.loading}
          empty={<EmptyState title="No quotations yet" description="Create one to get started." />}
        />
      ) : (
        <StageBoard
          grouped={grouped}
          loading={quotes.loading}
          onOpen={(q) => navigate(`/quotations/${q.id}`)}
        />
      )}
    </div>
  );
}

/**
 * The Kanban. Columns scroll horizontally as a group rather than the page
 * scrolling sideways (design.md §7) — a page that scrolls horizontally reads as
 * broken even when the content is fine.
 */
function StageBoard({
  grouped,
  loading,
  onOpen,
}: {
  grouped: Map<QuotationStatus, QuotationSummary[]>;
  loading: boolean;
  onOpen: (q: QuotationSummary) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((s) => (
          <div key={s.status} className="space-y-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] grid-cols-6 gap-4">
        {STAGES.map((stage) => {
          const items = grouped.get(stage.status) ?? [];
          return (
            <div key={stage.status} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  {stage.label}
                </h2>
                <span className="text-xs tabular text-text-muted">{items.length}</span>
              </div>

              <div className="space-y-2">
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">
                    Nothing here
                  </p>
                ) : (
                  items.map((q) => <QuotationCard key={q.id} quote={q} onOpen={onOpen} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** B2.1 — customer, amount and stage on every card. */
function QuotationCard({
  quote,
  onOpen,
}: {
  quote: QuotationSummary;
  onOpen: (q: QuotationSummary) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(quote)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(quote);
        }
      }}
      className="cursor-pointer rounded-md border border-border bg-surface p-3 hover:border-brand"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text">{quote.customer_name}</span>
        <span className="text-xs tabular text-text-muted">{quote.ref}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-text">
        <Money cents={quote.total_cents} currency={quote.currency} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RiskBadge band={quote.risk_band} />
        <span className="truncate text-xs text-text-muted">{quote.owner_name}</span>
      </div>
    </div>
  );
}

/** Creating a quotation is choosing a customer. Nothing else is required. */
function NewQuotation({
  customers,
  busy,
  onCreate,
}: {
  customers: Customer[];
  busy: boolean;
  onCreate: (customerId: Id) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string>("");

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        New Quotation
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <Field label="Customer" htmlFor="new-quote-customer">
        <Select
          id="new-quote-customer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">Choose…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.tier_name} ({c.tier_max_discount_pct}%)
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="primary"
        loading={busy}
        disabled={!customerId}
        disabledReason="Choose a customer first"
        onClick={() => onCreate(Number(customerId))}
      >
        Create
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
