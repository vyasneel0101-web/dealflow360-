/**
 * shared/types.ts — the DealFlow360 API contract.
 *
 * Imported by the server, the internal SPA (web/) and the portal SPA (portal/).
 * This file is the single definition of every request and response shape, so a
 * contract drift becomes a compile error at build time rather than a bug found
 * during the demo.
 *
 * Conventions (see docs/DB_SCHEMA.md §0):
 *   - Money is ALWAYS integer minor units (cents) in a `Cents` field. Never a float.
 *   - Percentages are numbers where 18 means 18%. Exact NUMERIC(6,3) server-side.
 *   - Dates crossing the wire are ISO 8601 strings, never Date objects.
 *
 * Rule: Track A adds new shapes here FIRST and pushes, before implementing them.
 * Track B builds against the type while the endpoint is still being written.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Integer minor units. 1234 === $12.34. Never a float — see DB_SCHEMA.md §0. */
export type Cents = number;

/** Percentage where 18 means 18%, not 0.18. */
export type Percent = number;

/** ISO 8601 date-time, e.g. "2026-09-05T14:03:00.000Z". */
export type ISODateTime = string;

/** ISO 8601 calendar date, e.g. "2026-09-05". */
export type ISODate = string;

export type Id = number;

export type CurrencyCode = "USD" | "EUR";

// ─────────────────────────────────────────────────────────────────────────────
// Response envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
}

/**
 * Uniform error shape. `fields` is populated only for 400 validation failures
 * and carries EVERY invalid field at once, so the UI can mark them all in one
 * pass instead of one round trip per field (TRD.md §6).
 */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export type ApiErrorCode =
  | "VALIDATION_FAILED"      // 400
  | "UNAUTHENTICATED"        // 401
  | "FORBIDDEN"              // 403
  | "NOT_FOUND"              // 404 — also returned for "not yours", deliberately
  | "STATE_CONFLICT"         // 409 — illegal transition, insufficient stock
  | "BUSINESS_RULE"          // 422
  | "RATE_LIMITED"           // 429
  | "INTERNAL";              // 500 — generic message only, never a stack trace

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations — mirror the CHECK constraints in DB_SCHEMA.md
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "rep" | "manager" | "finance" | "admin";

export type QuotationStatus =
  | "draft"
  | "pending_approval"
  | "returned"
  | "approved"
  | "negotiation"
  | "confirmed"
  | "rejected";

/** LOW / MEDIUM / HIGH per wireframe screens 5, 6 and 18. */
export type RiskBand = "low" | "medium" | "high";

/** Which reviewers a band demands. `[]` means auto-approved. */
export type ApprovalLevel = "manager" | "finance";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "returned";

export type LineType = "one_time" | "recurring";

export type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";

export type OrderStatus =
  | "split_pending"
  | "reserved"
  | "partially_shipped"
  | "shipped"
  | "backorder"
  | "cancelled";

export type ShipmentStatus = "proposed" | "accepted" | "shipped";

export type SubscriptionStatus = "active" | "paused" | "cancelled";

export type InvoiceStatus = "unpaid" | "partial" | "paid" | "void";

export type PaymentMethod = "cash" | "bank" | "card";

export type PriceRuleType = "none" | "percent_off" | "fixed";

export type AlertType = "stalled" | "discount_anomaly" | "delivery_slippage";

export type ActorKind = "internal" | "portal" | "system";

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: Id;
  email: string;
  full_name: string;
  role: Role;
  sales_team_id: Id | null;
  sales_team_name: string | null;
  is_active: boolean;
  created_at: ISODateTime;
}

/**
 * A customer-side person. Deliberately NOT a User with role="customer" —
 * see DB_SCHEMA.md §2. The two identities are disjoint types so one can never
 * stand in for the other.
 */
export interface Contact {
  id: Id;
  customer_id: Id;
  customer_name: string;
  email: string;
  full_name: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  full_name: string;
  // NOTE: `role` is deliberately absent. It is set server-side to "rep".
  // Accepting it here would be the mass-assignment hole (TRD.md §3).
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  expires_at: ISODateTime;
  user: User;
}

export interface PortalAuthResponse {
  token: string;
  expires_at: ISODateTime;
  contact: Contact;
  quotation_id: Id;
}

export interface MagicLinkRequest {
  quotation_id: Id;
  contact_id: Id;
}

export interface MagicLinkResponse {
  /** Full URL the rep can copy. Surfaced in-app, not emailed — TRD.md §3. */
  url: string;
  expires_at: ISODateTime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers & configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerTier {
  id: Id;
  name: string;
  max_discount_pct: Percent;
  sort_order: number;
}

export interface Customer {
  id: Id;
  name: string;
  tier_id: Id;
  tier_name: string;
  tier_max_discount_pct: Percent;
  email: string | null;
  currency: CurrencyCode;
  archived_at: ISODateTime | null;
}

export interface ProductCategory {
  id: Id;
  name: string;
  max_discount_pct: Percent;
}

export interface ProductVariant {
  id: Id;
  product_id: Id;
  attribute: string;      // "Color"
  values: string;         // "Blue, Black"
  extra_price_cents: Cents;
}

export interface Product {
  id: Id;
  name: string;
  category_id: Id;
  category_name: string;
  category_max_discount_pct: Percent;
  base_price_cents: Cents;
  /** Required for margin (B3.4), upsell margin delta (B5.2) and A6.3 filtering. */
  cost_cents: Cents;
  unit: string;
  tax_pct: Percent;
  description: string | null;
  is_subscription: boolean;
  recurring_interval: RecurringInterval | null;
  qty_on_hand: number;
  is_promoted: boolean;
  archived_at: ISODateTime | null;
  variants: ProductVariant[];
}

export interface PriceList {
  id: Id;
  name: string;
  tier_id: Id | null;
  tier_name: string | null;
  currency: CurrencyCode;
  rule_type: PriceRuleType;
  /** For percent_off, 10 means "base price minus 10 percent" (wireframe screen 17). */
  rule_value: number;
  archived_at: ISODateTime | null;
}

/** The configurable routing table behind A3.3 — rows, never constants. */
export interface ApprovalChainRule {
  band: RiskBand;
  min_blended_score: number;
  min_worst_line: number;
  required_levels: ApprovalLevel[];
}

export interface DealHealthConfig {
  stalled_days: number;
  anomaly_multiplier: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue requests
//
// Note what is absent from every shape below: no `id`, no `archived_at`, no
// computed field. Those are set by services, and the validator rejects an
// unknown key outright rather than ignoring it (TRD.md §3).
// ─────────────────────────────────────────────────────────────────────────────

/** A2.1 — the six fields the PS names, plus the ones margin and billing need. */
export interface CreateProductRequest {
  name: string;
  category_id: Id;
  base_price_cents: Cents;
  /** Not optional: without it there is no margin, and B3.4/B5.2/A6.3 die. */
  cost_cents: Cents;
  unit: string;
  tax_pct?: Percent;
  description?: string | null;
  /** A2.6 — reveals the interval field in the UI when true. */
  is_subscription?: boolean;
  recurring_interval?: RecurringInterval | null;
  qty_on_hand?: number;
  is_promoted?: boolean;
}

export type UpdateProductRequest = Partial<CreateProductRequest>;

/** A2.2 — one row per attribute, matching wireframe screen 17's table. */
export interface CreateVariantRequest {
  attribute: string;
  values: string;
  extra_price_cents?: Cents;
}

export interface CreateCategoryRequest {
  name: string;
  /** The category ceiling half of the per-line limit (A3.2). */
  max_discount_pct: Percent;
}

export type UpdateCategoryRequest = Partial<CreateCategoryRequest>;

export interface CreateTierRequest {
  name: string;
  max_discount_pct: Percent;
  sort_order?: number;
}

export type UpdateTierRequest = Partial<CreateTierRequest>;

/** A2.3 / A2.5 — the rule is a stored formula, not a per-product price table. */
export interface CreatePriceListRequest {
  name: string;
  tier_id?: Id | null;
  currency?: CurrencyCode;
  rule_type: PriceRuleType;
  rule_value?: number;
}

export type UpdatePriceListRequest = Partial<CreatePriceListRequest>;

/** Step one of the three-step resolution: an explicit per-product override. */
export interface UpsertPriceListItemRequest {
  product_id: Id;
  price_cents: Cents;
}

/**
 * What `services/pricing.ts` returns, and what screen 4 renders. The steps are
 * carried alongside the answer so the UI can explain WHY a price is what it is
 * rather than just asserting it.
 */
export interface ResolvedPrice {
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  /** Which of the three steps produced the price, in the order applied. */
  source: "price_list_item" | "price_list_rule" | "base_price";
  base_price_cents: Cents;
  variant_extra_cents: Cents;
  price_list_id: Id | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Warehouses & stock
// ─────────────────────────────────────────────────────────────────────────────

export interface Warehouse {
  id: Id;
  name: string;
  /** Input to the split objective (A4.3). Lower is cheaper to ship from. */
  shipping_cost_weight: number;
  is_active: boolean;
}

export interface StockLevel {
  warehouse_id: Id;
  warehouse_name: string;
  product_id: Id;
  product_name: string;
  on_hand: number;
  reserved: number;
  /** Derived on read, never stored — DB_SCHEMA.md §4. */
  available: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotations
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotationLine {
  id: Id;
  quotation_id: Id;
  product_id: Id;
  product_name: string;
  category_name: string;
  variant_id: Id | null;
  variant_label: string | null;
  qty: number;
  /** Snapshotted when the line was added — DB_SCHEMA.md §5. */
  unit_price_cents: Cents;
  unit_cost_cents: Cents;
  discount_pct: Percent;
  line_type: LineType;
  recurring_interval: RecurringInterval | null;

  /** min(tier ceiling, category ceiling) — screen 4's "Limit" column. */
  ceiling_pct: Percent;
  /** max(0, discount - ceiling) — drives screen 4's "Status" column. */
  overage_pct: Percent;

  /** Computed: qty * unit_price * (1 - discount). */
  line_total_cents: Cents;
  line_margin_cents: Cents;
  sort_order: number;
}

/**
 * Output of services/risk.ts — TRD.md §5.1.
 *
 * Two statistics, not one, because PS §10 sets two requirements a single number
 * cannot meet at once: one badly-over line must flag the order regardless of its
 * size (worst_line_overage), AND many mildly-over lines must accumulate
 * (blended_score).
 */
export interface RiskEvaluation {
  /** S = Σ(overage_i × value_weight_i). Value-weighted average overage. */
  blended_score: number;
  /** M = max(overage_i). Worst single line, in percentage points. */
  worst_line_overage: number;
  band: RiskBand;
  /** [] means no approval needed — straight to fulfillment (B3.5). */
  required_levels: ApprovalLevel[];
  /** Per-line reasoning, rendered by screen 6's "Why This Quote Was Flagged". */
  lines: RiskLineBreakdown[];
  /**
   * True when tier or category configuration was missing and the evaluation
   * failed closed to the highest band. Under-approving loses margin;
   * over-approving is only an inconvenience.
   */
  failed_closed?: boolean;
}

export interface RiskLineBreakdown {
  line_id: Id;
  label: string;              // "Setup Service (Services)"
  discount_pct: Percent;
  ceiling_pct: Percent;
  overage_pct: Percent;
  value_weight: number;       // 0..1 share of order list value
  status: "ok" | "over";      // screen 4: "OK" / "OVER (+8pt)"
}

export interface QuotationSummary {
  id: Id;
  ref: string;                // "Q-1042"
  customer_id: Id;
  customer_name: string;
  status: QuotationStatus;
  currency: CurrencyCode;
  total_cents: Cents;
  risk_band: RiskBand | null;
  owner_user_id: Id;
  owner_name: string;
  last_activity_at: ISODateTime;
  created_at: ISODateTime;
}

export interface QuotationTotals {
  subtotal_cents: Cents;      // before discount
  discount_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  cost_cents: Cents;
  margin_cents: Cents;
  margin_pct: Percent;
  one_time_total_cents: Cents;
  recurring_total_cents: Cents;
}

/**
 * The full quotation. EVERY line mutation returns this whole object — the
 * client never derives a governance figure locally (TRD.md §4).
 */
export interface QuotationDetail {
  id: Id;
  ref: string;
  customer: Customer;
  price_list: PriceList | null;
  status: QuotationStatus;
  currency: CurrencyCode;
  owner_user_id: Id;
  owner_name: string;
  requested_delivery_date: ISODate | null;
  promised_date: ISODate | null;
  negotiation_round: number;
  lines: QuotationLine[];
  totals: QuotationTotals;
  risk: RiskEvaluation;
  last_activity_at: ISODateTime;
  created_at: ISODateTime;
  confirmed_at: ISODateTime | null;
}

export interface CreateQuotationRequest {
  customer_id: Id;
  price_list_id?: Id;
  requested_delivery_date?: ISODate;
}

export interface CreateLineRequest {
  product_id: Id;
  variant_id?: Id;
  qty: number;
  discount_pct: Percent;
}

export interface UpdateLineRequest {
  qty?: number;
  discount_pct?: Percent;
}

/** Order-level discount, applied across all lines (B3.3). */
export interface ApplyOrderDiscountRequest {
  discount_pct: Percent;
}

export interface SubmitQuotationResponse {
  quotation: QuotationDetail;
  /** Absent when the band was `low` and the quote auto-confirmed (B3.5). */
  approval_request_id: Id | null;
  auto_approved: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Approvals & audit
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalStep {
  id: Id;
  step_no: number;
  required_role: ApprovalLevel;
  assigned_user_id: Id | null;
  assigned_user_name: string | null;
  status: ApprovalStatus;
  note: string | null;
  acted_by_name: string | null;
  acted_at: ISODateTime | null;
}

export interface ApprovalSummary {
  id: Id;
  quotation_id: Id;
  quotation_ref: string;
  customer_name: string;
  risk_band: RiskBand;
  /** Current stage label for screen 5: "Sales Manager", "Finance", "Auto-Approved". */
  stage: string;
  assigned_to: string | null;
  status: ApprovalStatus;
  created_at: ISODateTime;
}

export interface ApprovalDetail {
  id: Id;
  quotation: QuotationDetail;
  negotiation_round: number;
  risk: RiskEvaluation;
  steps: ApprovalStep[];
  status: ApprovalStatus;
  audit: AuditEntry[];
  created_at: ISODateTime;
  closed_at: ISODateTime | null;
}

/** Note is required for `reject` and `return` — it becomes the audit reason. */
export interface ApprovalActionRequest {
  note?: string;
}

export interface AuditEntry {
  id: Id;
  entity_type: string;
  entity_id: Id;
  actor_kind: ActorKind;
  actor_name: string;
  action: string;
  note: string | null;
  created_at: ISODateTime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fulfillment
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitAllocation {
  warehouse_id: Id;
  warehouse_name: string;
  lines: { quotation_line_id: Id; product_name: string; qty: number }[];
  qty_fulfilled: number;
  est_shipment_count: number;
  est_cost_cents: Cents;
}

export interface BackorderItem {
  quotation_line_id: Id;
  product_name: string;
  qty_pending: number;
  /** True when stock has since arrived — triggers B6.4's consolidation prompt. */
  can_consolidate: boolean;
}

export interface SplitProposal {
  order_id: Id;
  allocations: SplitAllocation[];
  backorders: BackorderItem[];
  total_est_cost_cents: Cents;
  total_shipments: number;
}

export interface OrderSummary {
  id: Id;
  ref: string;
  quotation_id: Id;
  quotation_ref: string;
  customer_name: string;
  status: OrderStatus;
  warehouses: string[];        // screen 7: "Main + East Depot"
  promised_date: ISODate | null;
}

export interface ManualSplitRequest {
  allocations: {
    warehouse_id: Id;
    lines: { quotation_line_id: Id; qty: number }[];
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions & billing
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: Id;
  name: string;
  interval: RecurringInterval;
  proration_mode: "daily" | "none";
  refund_policy: "prorated_credit" | "none";
}

export interface SubscriptionSummary {
  id: Id;
  customer_id: Id;
  customer_name: string;
  plan_name: string;
  interval: RecurringInterval;
  next_bill_date: ISODate | null;
  status: SubscriptionStatus;
  qty: number;
  unit_price_cents: Cents;
}

export interface BillingScheduleEntry {
  id: Id;
  period_start: ISODate;
  period_end: ISODate;
  amount_cents: Cents;
  status: "scheduled" | "invoiced" | "skipped";
  invoice_id: Id | null;
}

export interface ProrationEntry {
  id: Id;
  change_type: "qty" | "plan" | "cancel" | "pause";
  old_qty: number | null;
  new_qty: number | null;
  effective_at: ISODateTime;
  /** Signed: positive = extra charge, negative = credit owed. */
  proration_cents: Cents;
  credit_note_id: Id | null;
}

/** Screen 10 — one-time and recurring lines shown separately on one order (B7.1). */
export interface BillingDetail {
  subscription: SubscriptionSummary;
  plan: SubscriptionPlan;
  origin_quotation_ref: string;
  one_time_lines: { description: string; qty: number; amount_cents: Cents }[];
  recurring_lines: {
    description: string;
    interval: RecurringInterval;
    next_bill_date: ISODate | null;
    amount_cents: Cents;
  }[];
  schedule: BillingScheduleEntry[];
  proration_history: ProrationEntry[];
}

export interface ModifySubscriptionRequest {
  qty?: number;
  plan_id?: Id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoices & payments
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: Id;
  ref: string;                // "INV-1042"
  customer_name: string;
  kind: "one_time" | "recurring";
  amount_cents: Cents;
  paid_cents: Cents;
  status: InvoiceStatus;
  due_date: ISODate;
  issued_at: ISODateTime;
}

export interface InvoiceLine {
  id: Id;
  description: string;
  qty: number;
  amount_cents: Cents;
  /**
   * Present only where a shipment exists. This is how C4 is enforced —
   * "nothing is billed before it ships" (wireframe screen 13).
   */
  shipment_id: Id | null;
}

export interface Payment {
  id: Id;
  amount_cents: Cents;
  method: PaymentMethod;
  reference: string | null;
  recorded_by_name: string;
  recorded_at: ISODateTime;
}

export interface InvoiceDetail extends InvoiceSummary {
  lines: InvoiceLine[];
  payments: Payment[];
  /** Screen 13's stepper: Order Confirmed → Shipped → Invoiced → Paid. */
  lifecycle: {
    order_confirmed: boolean;
    shipped: boolean;
    invoiced: boolean;
    paid: boolean;
  };
}

export interface RecordPaymentRequest {
  amount_cents: Cents;
  method: PaymentMethod;
  reference?: string;
}

export interface CreditNote {
  id: Id;
  customer_name: string;
  invoice_ref: string | null;
  amount_cents: Cents;
  reason: string;
  created_at: ISODateTime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal — customer-facing
// ─────────────────────────────────────────────────────────────────────────────

export interface PortalComment {
  id: Id;
  quotation_line_id: Id | null;
  line_label: string | null;
  author_name: string;
  body: string;
  created_at: ISODateTime;
}

/**
 * The customer's view. Deliberately narrower than QuotationDetail — no margin,
 * no cost, no risk band, no internal vocabulary (design.md §6).
 */
export interface PortalQuotationView {
  ref: string;
  status: QuotationStatus;
  status_label: string;        // "Sent" | "Under Negotiation" | "Confirmed"
  currency: CurrencyCode;
  lines: {
    id: Id;
    product_name: string;
    qty: number;
    unit_price_cents: Cents;
    discount_pct: Percent;
    line_total_cents: Cents;
  }[];
  total_cents: Cents;
  requested_delivery_date: ISODate | null;
  comments: PortalComment[];
  negotiation_round: number;
}

export interface PortalCommentRequest {
  quotation_line_id?: Id;
  body: string;
}

export interface PortalNegotiateRequest {
  counter_discount_pct?: Percent;
  requested_delivery_date?: ISODate;
  message?: string;
}

/**
 * Result of the customer confirming (B8.6). If the agreed terms breach the
 * thresholds, `re_entered_approval` is true and the quote goes back to B4
 * automatically — the same risk service runs regardless of who changed the terms.
 */
export interface PortalConfirmResponse {
  status: QuotationStatus;
  status_label: string;
  re_entered_approval: boolean;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence
// ─────────────────────────────────────────────────────────────────────────────

/** Ranked by lift × promo_boost, filtered by min margin threshold (TRD.md §5.3). */
export interface UpsellSuggestion {
  product_id: Id;
  product_name: string;
  price_cents: Cents;
  /** Margin added to the order if accepted — screen 4's "Margin +$46". */
  margin_delta_cents: Cents;
  is_promoted: boolean;
  promo_label: string | null;   // "Promo: 12% off"
  lift: number;
  /**
   * "history" when derived from co-purchase data, "fallback" when the catalogue
   * has no order history yet and we are showing category matches instead.
   * The UI states which, honestly — design.md §5.
   */
  source: "history" | "fallback";
}

export interface DealAlert {
  id: Id;
  quotation_id: Id;
  quotation_ref: string;
  customer_name: string;
  alert_type: AlertType;
  detail: string;               // "Discount 22% vs avg 8%"
  flagged_at: ISODateTime;
  action_taken: string | null;  // "Nudge sent" | "Escalated to Manager"
}

export interface DealHealthDashboard {
  stalled_count: number;
  anomaly_count: number;
  slippage_count: number;
  config: DealHealthConfig;
  alerts: DealAlert[];
}

export interface NudgeRequest {
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard & reporting
// ─────────────────────────────────────────────────────────────────────────────

/** Screen 2 — the home hub. Recent activity is a read of the audit log. */
export interface SalesDashboard {
  pending_approvals: number;
  open_quotations: number;
  at_risk_deals: number;
  recent_activity: AuditEntry[];
}

export interface ReportFilters {
  period_from?: ISODate;
  period_to?: ISODate;
  sales_team_id?: Id;
  owner_user_id?: Id;
  approval_status?: ApprovalStatus;
  category_id?: Id;
  product_id?: Id;
}

export interface ReportSummary {
  quotes_created: number;
  avg_approval_hours: number | null;
  top_upsold_product: string | null;
  total_value_cents: Cents;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  by_category: { category_name: string; count: number; value_cents: Cents }[];
  most_discounted: { product_name: string; avg_discount_pct: Percent }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-Sent Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payloads carry IDs only; the client refetches. That keeps authorization on the
 * fetch, so a pushed event can never leak a field the recipient may not see.
 */
export type ServerEvent =
  | { type: "stock.changed"; product_id: Id; warehouse_id: Id }
  | { type: "quotation.updated"; quotation_id: Id }
  | { type: "approval.changed"; approval_id: Id; quotation_id: Id }
  | { type: "alert.raised"; alert_id: Id; quotation_id: Id }
  | { type: "invoice.paid"; invoice_id: Id };
