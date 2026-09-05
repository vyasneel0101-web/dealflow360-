# PRD.md — DealFlow360

**Phase 1 deliverable.** Problem statement: DealFlow360 — An Intelligent, Self-Governing Sales Operations Platform.
**Date:** 2026-09-05 · **Author:** team · **Status:** awaiting scope sign-off before Phase 2

---

## 1. Problem restated in our own words

A B2B sales team's real job is not producing a quote — it is **producing a quote that the company can actually honour**. Three things make that hard, and ordinary quote-to-invoice tools ignore all three.

**First, discounting leaks margin quietly.** A rep working a Gold account "knows" they have 15% to give. But a services line at 18% against a 10% category ceiling has broken a rule the customer tier never covered. Worse, a rep can keep *every* line technically inside its limit while still giving away far more across the order than the company intended. Discount governance therefore cannot be a single number checked once — it has to evaluate every line against its own ceiling *and* evaluate the pattern across the order, then decide by itself who needs to review the deal. If it doesn't decide by itself, managers end up hand-reviewing every quotation, and the control collapses into a rubber stamp.

**Second, the quote is written against inventory that doesn't exist in one place.** Stock is spread across warehouses. A promise made at quote time is a promise about physical goods, and honouring it cheaply means splitting the order to minimise shipments — a decision the system should propose and the human should be able to override.

**Third, the quote stops being a document the moment a customer reads it.** Real negotiation happens: line-level objections, counter-offers on discount. Doing that over email means the governance rules above are bypassed entirely, because the final agreed terms never re-enter approval. The quotation has to be a **living, negotiable object** that a customer can touch directly from a restricted portal — and any change they win has to be re-tested against the same discount rules that governed the rep.

Add hybrid billing — one order carrying both one-time hardware and recurring subscription lines, each with its own schedule and proration behaviour — and the shape of the problem is clear.

**What we are building:** a sales platform where the governance is *in the system, not in the process*. The system decides who must approve, proposes how to fulfil, keeps recurring and one-time revenue reconciled on a single order, lets the customer negotiate inside guardrails that automatically reassert themselves, and surfaces deals going wrong while they can still be saved.

**What we are explicitly not building:** a prettier quote form.

---

## 2. Scope directive

> **Team decision, 2026-09-05 10:40:** full problem-statement coverage. No feature stated in the PS is cut, **including every nice-to-have.** No features invented beyond the PS. No bloat.

This overrides the tiered scope contract proposed in `DECISION.md` §Step C. The tiers below are retained **only as build ordering**, not as a cut list — everything ships.

| Tier | Meaning here |
|---|---|
| **P0** | Core spine. Nothing else is demoable without it. Build first. |
| **P1** | Stated must-have. Ships. |
| **P2** | Stated nice-to-have / PS-marked optional. **Ships** — ordered last only because it depends on P0/P1 existing. |
| **BONUS** | The PS's own word ("bonus, not a requirement"). Built only after all of P0–P2 is green. |

The only true cut list is §9, and it contains nothing the PS asks for.

---

## 3. Personas & permission matrix

Five roles, per PS §3. Permissions are enforced server-side on every endpoint, never only in the UI.

| Capability | Sales Rep | Sales Manager | Finance/Ops | Customer (Portal) | Admin |
|---|---|---|---|---|---|
| Build/edit own quotations | ✅ | ✅ | — | — | ✅ |
| View others' quotations | — | ✅ team | ✅ | — | ✅ |
| Apply discounts, add upsell items | ✅ | ✅ | — | — | ✅ |
| Track approval status & fulfillment | ✅ own | ✅ | ✅ | — | ✅ |
| Respond to negotiation requests | ✅ own | ✅ | — | — | ✅ |
| Approve/reject/return (level 1) | — | ✅ | — | — | ✅ |
| Approve/reject/return (level 2, high risk) | — | — | ✅ | — | ✅ |
| Configure discount tiers & approval chains | — | ✅ | — | — | ✅ |
| Manage warehouse splits & backorder decisions | — | — | ✅ | — | ✅ |
| Reconcile recurring billing & credit notes | — | — | ✅ | — | ✅ |
| Deal-health dashboard | — | ✅ | ✅ | — | ✅ |
| Backend config (products, price lists, warehouses, plans) | — | — | — | — | ✅ |
| Platform-wide analytics | — | ✅ team | ✅ | — | ✅ |
| View **own** quotation only | — | — | — | ✅ | — |
| Comment / request change / counter-discount | — | — | — | ✅ | — |
| Confirm quotation | — | — | — | ✅ | ✅ |

**Portal isolation is a hard requirement, not a view filter.** PS §7: *"The customer facing negotiation screen must be a real, separate, restricted view, not just another internal screen with a different label."* A portal session must be structurally incapable of reaching internal endpoints — enforced at the auth layer, verified in Phase 5.

---

## 4. Primary user flows

**Flow 1 — Governed quote to cash (the spine).** Rep logs in → opens workspace → creates quotation → adds lines across categories → applies discounts → sees live margin move → accepts an upsell suggestion → confirms → system computes blended risk score → auto-routes to Manager (and Finance if warranted) → approver acts, audit entry written → system proposes warehouse split → rep accepts or overrides → order confirmed → one-time lines invoiced, recurring lines scheduled → payment recorded → invoice status updates.

**Flow 2 — Customer negotiation re-entering governance.** Rep sends quotation link → customer opens restricted portal → comments on a line, counters the discount → rep responds → customer confirms → **system re-evaluates the risk score against the new terms** → if thresholds are breached the quote automatically re-enters approval at B4; otherwise it proceeds straight to fulfillment.

**Flow 3 — Manager catching a deal going wrong.** Manager opens deal-health dashboard → sees a stalled deal and a discount anomaly flagged against the rep's own historical average → clicks the alert → lands directly on the quotation → triggers a nudge/escalation.

These three are the demo. Flows 1 and 2 are the two end-to-end flows required by PS §8.

---

## 5. Functional requirements

Traceability: every requirement carries its PS module ID. Success criteria are written as **what a judge does to verify it**, per the master prompt.

### A) Sales Backend — configuration

| ID | Requirement | Tier | Judge verifies by |
|---|---|---|---|
| **A1.1** | Internal users sign up and log in with credentials. Passwords hashed with a vetted algorithm. | P0 | Signs up, logs out, logs back in. Inspects DB — no plaintext password. |
| **A1.2** | Customers access quotations via portal login (**magic link** or email+password). We ship magic-link as primary, password as fallback. | P0 | Opens a portal link, lands on their quote only. |
| **A1.3** | After login internal users can reach backend configuration and open a sales workspace. | P0 | Both destinations reachable from the post-login screen. |
| **A2.1** | Product general info: Name, Category, Price, Unit, Tax, Description. | P0 | Creates a product with all six fields; they persist and appear on a quote line. |
| **A2.2** | Product **variants**: attribute (e.g. Size, Pack), values, extra prices. | P1 | Creates a product with two variants at different extra prices; picks one on a quote; correct price applied. |
| **A2.3** | **Price lists**: customer-tier-based pricing and currency-specific rules. | P1 | Creates two price lists, assigns to different tiers; same product quotes at different prices per customer tier. |
| **A3.1** | Discount ceilings **per customer tier** (Bronze 5% / Silver 10% / Gold 15%, all editable). | P0 | Edits Gold to 20%; a previously-flagged quote stops flagging. |
| **A3.2** | Discount ceilings **per product category**, independent of tier. | P0 | Sets Services to 10%; an 18% services line flags even for a Gold customer. |
| **A3.3** | Configurable approval chain: which risk range needs Manager only, which needs Manager → Finance. | P0 | Lowers the Finance threshold; a quote that needed one approver now needs two. |
| **A3.4** | **Blended risk score** across mixed-category orders, routing to the highest required level. | P0 | Builds the PS §10 example (Laptop 12/15, Setup Service 18/10) — quote flags on the services line. |
| **A3.5** | **Audit log**: every approval, rejection and edit recorded with user, timestamp and reason. Append-only. | P0 | Approves with a reason, then inspects the audit trail; entry present, immutable. |
| **A4.1** | Create and manage warehouses (e.g. Main Warehouse, East Depot). | P1 | Creates a third warehouse; it appears in split proposals. |
| **A4.2** | Per-warehouse stock levels and replenishment rules. | P1 | Sets stock to 3 units; a 5-unit order splits or backorders. |
| **A4.3** | **Shipping cost weighting** used by auto-split to minimise shipment count. | P1 | Raises East Depot's weighting; the proposed split shifts toward Main. |
| **A5.1** | Recurring plans (monthly / quarterly / yearly) attachable to products or services. | P1 | Attaches a monthly plan to a service; it bills as recurring, not one-time. |
| **A5.2** | Proration rules for mid-cycle quantity or plan changes. | P1 | Changes quantity mid-cycle; prorated amount matches hand calculation. |
| **A5.3** | Cancellation and partial-refund rules. | P1 | Cancels mid-cycle; a credit note is generated for the correct unused portion. |
| **A6.1** | Product pairings derived from **historical co-purchase data**. | P2 | Seeds order history, opens a quote with product A, sees B suggested. |
| **A6.2** | Mark products **promoted** so they rank higher in suggestions. | P2 | Promotes a product; it climbs the ranked list and shows a promotion tag. |
| **A6.3** | **Minimum margin threshold** so only healthy-margin suggestions surface. | P2 | Raises the threshold; thin-margin suggestions disappear. |
| **A7.1** | Dashboard + reporting menu for sales performance. | P1 | Reaches reporting from the main nav. |
| **A7.2** | Report filters: **Period** (today / week / custom range). | P1 | Narrows to today; totals shrink correctly. |
| **A7.3** | Report filter: **Sales Team / Rep**. | P1 | Filters to one rep; only their deals remain. |
| **A7.4** | Report filter: **Approval Status** (pending / approved / rejected). | P1 | Filters to pending; only unapproved quotes remain. |
| **A7.5** | Report filter: **Product / Category** — best-selling and most-discounted items. | P1 | Filters to Hardware; services lines drop out. |
| **A7.6** | Export **PDF**. | P1 | Downloads a PDF matching the on-screen figures. |
| **A7.7** | Export **XLS**. | P1 | Downloads a spreadsheet matching the on-screen figures. |

### B) Sales Frontend — rep workspace

| ID | Requirement | Tier | Judge verifies by |
|---|---|---|---|
| **B1.1** | Top nav: **Quotations** (list of active + draft) and **Pipeline** (Kanban). | P0 | Both routes load with real data. |
| **B1.2** | Action: **Reload Data** — refreshes pricing, stock and approval data from backend. | P2 | Changes stock in another tab, hits Reload, sees the new figure. |
| **B1.3** | Action: **Go to Back-end** — opens configuration. | P2 | Navigates to config. |
| **B1.4** | Action: **Close Workspace** — ends the working session view. | P2 | Returns to the post-login screen. |
| **B2.1** | Quotations as selectable cards showing customer, amount and stage. | P0 | Sees seeded entries ("Acme Corp — Draft", "Beta Industries — Pending Approval"). |
| **B2.2** | Selecting a quotation opens the Quotation Builder for that deal. | P0 | Clicks a card, lands in the builder with lines loaded. |
| **B3.1** | Pick products across categories (Hardware, Services, Subscriptions). | P0 | Adds one line from each category. |
| **B3.2** | Adjust quantities (+/−). | P0 | Increments; totals recompute. |
| **B3.3** | **Line-level and order-level** discounts, both supported. | P0 | Applies both; both reflected in totals and in the risk score. |
| **B3.4** | Order lines with price totals and a **live margin indicator**. | P0 | Changes a discount; margin updates without a page reload. |
| **B3.5** | Confirm → routes to approval, **or straight to fulfillment when no approval is required**. | P0 | Confirms a compliant quote; it skips approval entirely. |
| **B4.1** | Approval screen shows the **blended risk score**. | P0 | Score displayed with its per-line breakdown. |
| **B4.2** | Approval steps list — Finance shown **only when required**. | P0 | Low-risk quote shows one step; high-risk shows two. |
| **B4.3** | Reviewer can **Approve / Reject / Return for revision**. | P0 | Exercises all three; state changes correctly each time. |
| **B4.4** | Confirmation screen with a full audit trail entry. | P0 | Reads the trail after acting. |
| **B5.1** | Upsell panel alongside the cart, **ranked** by co-purchase history and active promotions. | P2 | Panel populates while building a quote. |
| **B5.2** | Each suggestion displays product, **margin delta if added**, and promotion tag. | P2 | All three visible per suggestion. |
| **B5.3** | Buttons: **Add to Quote** and **Dismiss**. | P2 | Adds one, dismisses another; dismissed one does not return. |
| **B5.4** | Margin indicator updates **immediately** after adding a suggestion. | P2 | Adds a suggestion; margin moves at once. |
| **B6.1** | Recommended warehouse split based on **live stock**. | P1 | Sees a split proposal reflecting real stock levels. |
| **B6.2** | Displays warehouse name, quantity from each, **estimated shipment count and cost**. | P1 | All four values shown. |
| **B6.3** | Buttons: **Accept Suggested Split** and **Manual Override**. | P1 | Overrides the split; the override persists. |
| **B6.4** | **"Consolidate Remaining Backorder"** prompt appears automatically when stock arrives mid-fulfillment. | P2 | Adds stock to a backordered order; the prompt appears unprompted. |
| **B7.1** | One-time and recurring lines shown **separately within the same order**. | P1 | Mixed order displays two distinct sections. |
| **B7.2** | Upcoming **billing schedule** for recurring lines. | P1 | Sees future billing dates and amounts. |
| **B7.3** | Mid-cycle **proration** on quantity change. | P1 | Changes quantity; proration is correct and explained. |
| **B7.4** | Cancel/modify subscription controls with **automatic partial refund or credit note** trigger. | P1 | Cancels; credit note generated automatically. |
| **B8.1** | Customer-facing screen, **separate and restricted** from the internal workspace. | P0 | Attempts an internal URL from a portal session; is refused. |
| **B8.2** | Shows quotation details and status (**Sent / Under Negotiation / Confirmed**). | P0 | Status transitions visible as the flow progresses. |
| **B8.3** | **Line-level comment** and change-request tool. | P0 | Leaves a comment on one line; rep sees it. |
| **B8.4** | **Counter-discount proposal** field. | P0 | Counters at a higher discount; rep sees the counter. |
| **B8.5** | Buttons: **Submit Request** and **Confirm Quotation**. | P0 | Exercises both. |
| **B8.6** | On confirmation: if final terms exceed thresholds, **automatically re-enter the approval flow (B4)**; otherwise move to fulfillment. | P0 | Counters beyond the ceiling, confirms — quote returns to approval without rep action. |
| **B9.1** | **Stalled deals** — quotations inactive beyond a **configured** number of days. | P1 | Changes the threshold; the stalled list changes. |
| **B9.2** | **Discount anomaly alerts** — discount well above that rep's **historical average**. | P1 | Creates an outlier discount for a rep with history; alert fires. |
| **B9.3** | **Delivery promise slippage** indicators. | P1 | An order past its promised date is flagged. |
| **B9.4** | Clicking an alert opens the related quotation directly. | P1 | Clicks through; lands on the right quote. |
| **B9.5** | **Automated nudge or escalation** triggerable from an alert. | P2 | Triggers a nudge; it is recorded against the deal. |

### C) Requirements implied by PS §9 (Quick Test Flow) and §3

The PS's own eight-step acceptance walkthrough ends with *"record a payment, and check that the invoice status updates correctly"*, and PS §3 gives Finance *"reconciles recurring billing and credit notes"*. These are requirements even though no lettered module states them.

| ID | Requirement | Tier | Judge verifies by |
|---|---|---|---|
| **C1** | Confirmed order generates an **invoice** for one-time lines. | P1 | Confirms an order; invoice exists with correct total. |
| **C2** | **Payment recording** against an invoice, with status transitioning (Unpaid → Partially Paid → Paid). | P1 | Records a partial then full payment; status moves correctly at each step. |
| **C3** | **Credit notes** as first-class records, generated by cancellation/refund (A5.3, B7.4) and reconcilable by Finance. | P1 | Cancels a subscription; credit note appears in Finance's view. |

### D) Bonus tier — PS §7, "bonus, not a requirement"

| ID | Requirement | Tier |
|---|---|---|
| **D1** | Multi-currency across the application (display, conversion, reporting). Distinct from A2.3, which is in scope. | BONUS |
| **D2** | Multi-company support. | BONUS |

**Interpretation stated explicitly:** A2.3's *"currency specific rules"* on price lists **is in scope** — a price list carries a currency and currency-scoped rules. Full application-wide multi-currency conversion is the bonus. If the team wants D1/D2 promoted, say so; they are not currently blocking anything.

---

## 6. The two algorithms

Both are hand-built arithmetic, no model, no library, no training. This is deliberate — see `DECISION.md` criterion 3. Full treatment lands in `AI_EXPLAINABILITY.md` during Phase 3; specification level here.

### 6.1 Blended discount risk score (A3.4)

The PS describes the intent in §10 and leaves the formula to us. It sets two requirements that a single number cannot satisfy alone:

1. *"the Service line broke its own stricter limit… the whole quotation gets flagged"* → one badly-over line must flag the order.
2. *"None of them look alarming alone, but added together… the rep has quietly given away a lot of margin"* → many mildly-over lines must aggregate.

So we compute **two** statistics and route on both.

For each line `i`: given discount `dᵢ`, effective ceiling `cᵢ = min(tier_ceiling, category_ceiling)`, overage `oᵢ = max(0, dᵢ − cᵢ)` in percentage points, and value weight `wᵢ = line_list_value / order_list_value`.

- **Blended score** `S = Σ(oᵢ × wᵢ)` — value-weighted average overage. Catches requirement 2: small overages across many lines accumulate, and a small overage on a large line outweighs a small overage on a trivial one.
- **Worst-line severity** `M = max(oᵢ)` — catches requirement 1 regardless of how little of the order that line represents.

Routing, with all four thresholds configurable in A3.3:

| Condition | Outcome |
|---|---|
| `S = 0` and `M = 0` | No approval — straight to fulfillment (B3.5) |
| `M ≥ M_manager` **or** `S ≥ S_manager` | Sales Manager |
| `M ≥ M_finance` **or** `S ≥ S_finance` | Sales Manager → Finance |

Why weighted rather than a plain average: an unweighted mean lets a rep hide a large overage on the order's biggest line behind many compliant trivial lines. Why keep `M` separate rather than folding it into `S`: any weighting scheme that makes a single small line able to flag the order would make the aggregate meaningless. The two statistics answer two different questions and are not reducible to one.

**Recomputed on every term change, including customer-initiated ones** — this is the mechanism behind B8.6.

### 6.2 Upsell / cross-sell ranking (A6.1–A6.3, B5.1–B5.4)

Association strength by **lift** over historical confirmed orders: `lift(A→B) = P(B | A) / P(B)` — how much more likely B is in an order given A, versus B's base rate. Lift, not raw co-occurrence count, because raw counts just surface the best-selling product to everybody.

Ranking: `score = lift × promo_boost`, filtered to `margin_delta ≥ min_margin_threshold` (A6.3). Promoted products (A6.2) receive `promo_boost`; unpromoted receive 1.0.

**Cold-start fallback** — the failure mode that matters, since a fresh install has no order history: fall back to category affinity plus the promoted flag, and label the panel honestly as such. A suggestion panel that silently shows nothing looks broken; one that says why it is thin looks deliberate.

---

## 7. Non-functional requirements

**Security** — the largest surface here is the portal, and the PS flags it directly.

- Passwords hashed with a vetted algorithm (named in `TRD.md`). Never logged, never returned by an API.
- Portal sessions structurally partitioned from internal sessions — a portal token cannot authenticate against an internal endpoint even with a valid signature.
- Authorization enforced server-side per request. Object-level checks on every resource fetch: no user reaches another user's quotation by guessing an ID, and no customer reaches another customer's.
- Mass-assignment blocked — `role`, `tier`, approval state and price fields are never settable from a request body.
- Magic-link tokens: single-use, expiring, high-entropy, scoped to one quotation.
- Audit log append-only at the data layer, not by convention.

**Data integrity**

- Approval state machine permits legal transitions only; illegal transitions rejected at the service layer, not hidden in the UI.
- Stock decrement and reservation are concurrency-safe — two simultaneous confirmations cannot oversell the same unit.
- Quotation terms are snapshotted per negotiation round, so an audit entry refers to the terms that actually existed when it was written.
- Money as integer minor units throughout. No floating-point currency arithmetic anywhere.
- Discounts, ceilings and thresholds are stored configuration, never constants in code (PS §7: *"must be implemented in application logic, not hardcoded or faked for the demo"*).

**Performance** — dashboard and reports respond under ~500 ms on seed-scale data; the live margin indicator updates without a full page reload; list endpoints paginate rather than returning unbounded sets.

**Robustness** — malformed input returns a structured error, never a stack trace. Empty states are designed, not blank. The upsell panel degrades to its fallback rather than erroring when history is absent.

---

## 8. Nice-to-have register — every one, with a decision

Per the master prompt: *"Every nice-to-have from the problem statement gets a line in the backlog with an explicit Include/Cut decision and reasoning."* Under the §2 directive all are **Include**; reasoning is recorded for the stage round regardless.

| # | Nice-to-have (source) | Decision | Reasoning |
|---|---|---|---|
| 1 | Upsell/cross-sell rule setup — PS marks A6 **"(Optional)"** | **Include** | The co-purchase model is cheap once orders exist, and B5 is one of the most visible things in the demo. |
| 2 | Promoted-product ranking (A6.2) | **Include** | One boolean plus a multiplier in the ranking function. |
| 3 | Minimum margin threshold on suggestions (A6.3) | **Include** | One comparison; it is also what makes the upsell feature defensible rather than a gimmick. |
| 4 | Product variants (A2.2) | **Include** | Stated requirement; affects pricing correctness. |
| 5 | "Reload Data" workspace action (B1.2) | **Include** | Small, and it demonstrates that stock and pricing are genuinely live. |
| 6 | "Go to Back-end" workspace action (B1.3) | **Include** | Trivial routing. |
| 7 | "Close Workspace" workspace action (B1.4) | **Include** | Trivial routing. |
| 8 | Backorder consolidation prompt (B6.4) | **Include** | Distinctive detail most teams will skip; it is the payoff of modelling stock properly. |
| 9 | Automated nudge / escalation from an alert (B9.5) | **Include** | Completes the deal-health loop — without it the dashboard is read-only. |
| 10 | Delivery promise slippage indicator (B9.3) | **Include** | Needs a promised-date field, which fulfillment already implies. |
| 11 | XLS export (A7.7) | **Include** | Stated alongside PDF. |
| 12 | Multi-currency (PS §7 **"bonus"**) | **BONUS** | The PS's own classification. Built after P0–P2 are green. Not a cut — see §5.D. |
| 13 | Multi-company (PS §7 **"bonus"**) | **BONUS** | As above. |

---

## 9. Cut list

**Empty by directive.** Nothing the problem statement asks for is cut.

Recorded for honesty at the stage round: the only items not in the P0–P2 build are D1 and D2, which the PS itself classifies as bonus rather than requirement. If they do not ship, the correct answer to *"what didn't you build?"* is that we shipped 100% of the requirements and nice-to-haves and treated the PS's stated bonuses as bonuses.

---

## 10. Acceptance criteria

The PS supplies its own acceptance test in §9. We adopt all eight steps verbatim as the release gate — the build is not "done" until every step passes in sequence on seeded data.

| # | Step (PS §9) | Covered by |
|---|---|---|
| 1 | Sign up / log in; set up a discount tier, a warehouse, a subscription plan | A1.1, A3.1, A4.1, A5.1 |
| 2 | Create a quotation with a discount above what is allowed | B3.1–B3.3 |
| 3 | Confirm it **automatically** asks for manager approval, without the rep requesting it | A3.4, B3.5, B4.2 |
| 4 | Accept an upsell suggestion; total and margin update **right away** | B5.3, B5.4 |
| 5 | Get it approved; stock pulled from the correct warehouse, splitting across two if needed | B4.3, B6.1, B6.2 |
| 6 | One-time product and recurring subscription on one order billed correctly and separately | B7.1, B7.2, C1 |
| 7 | As the customer, request a bigger discount in the portal; quote **automatically** returns to approval | B8.4, B8.6 |
| 8 | Confirm the order, record a payment, invoice status updates correctly | C1, C2 |

Additionally, per PS §8: seed data present, a five-minute demo covering two full flows (§4 Flows 1 and 2), a one-page architecture diagram (`TRD.md`), and a next-steps note.

---

## 11. Open questions

| # | Question | Impact | Working assumption |
|---|---|---|---|
| 1 | Actual submission deadline? | Sets the real build budget | 09:00 tomorrow (24h from a 09:00 start), per "working through the night" |
| 2 | Promote multi-currency/multi-company (D1/D2) into scope? | ~2h if promoted | Left as BONUS, per the PS's own wording |
| 3 | Magic link delivery — real SMTP or captured in-app? | Demo reliability | Generated and shown in-app, with SMTP if a mail service is reachable; a demo must not depend on inbox delivery |
