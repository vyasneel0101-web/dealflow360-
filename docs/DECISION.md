# DECISION.md — Phase 0: Problem Statement Selection

**Status:** FINAL — pending team sign-off to open Phase 1.
**Date:** 2026-09-05
**Decided at:** 10:30 (Phase 0 ran 60 min over the 09:45 contract deadline; see re-baselined timeline below)
**Team profile (input to criterion 6):** two strong full-stack developers; little to no ML/AI experience.

---

## Step A — Structural extraction

### PS1 — PeoplePay360: HR & Payroll

| Dimension | Content |
|---|---|
| **Core ask** | An integrated HR + payroll platform where the Employee record is the hub: contracts and working schedules supply payroll context, attendance and time-off capture daily activity, salary structures/rules define computation, and Payruns turn eligible employees into validated payslips (PDF + email) surfaced on a live dashboard. |
| **Explicit must-haves** | Employee master (Kanban/List/Form + smart-buttons to related records); contract history with period-correct active contract; working schedules with **auto-computed** weekly hours; time-off types, allocations, requests, approval, balance consumption; salary structures as ordered rule containers; salary rules with category (Basic/Allowance/Gross/Deduction/Net), sequence, and fixed/percentage/formula computation; **two-step Payrun wizard** (scope then employee selection); payslip compute with per-rule breakdown; Compute / Validate / Mark Paid / Send Payslips; pre-finalization warnings; payslip PDF; bulk email; Payroll Dashboard with live KPIs and charts; **5 roles** with distinct permission sets. |
| **Nice-to-haves (buried in prose, not bulleted)** | Attendance *exception* handling and manual-edit tracking; overtime; missing check-outs; "attendance coverage" and "attendance health" metrics; employee-type filters on dashboard; duplicate-payslip detection; missing bank-detail warnings; "contract attention items"; archival of finalized payruns as history; department by headcount by salary breakdown. |
| **Implied expectations a judge assumes** | Payroll compute must be **idempotent / re-runnable** without double-posting. Leave balance must not go negative under concurrent approvals. Payslips become **immutable once paid**. Contract selection must handle period boundaries (contract starting mid-period). Manual attendance edits need an audit trail. Dashboard numbers must reconcile with underlying records. |
| **AI/ML fit** | Bolt-on, not intrinsic. Plausible: attendance anomaly detection, payroll-error prediction (net deviates from an employee's own baseline), attrition risk. Nothing in the PS *requires* it. |
| **Odoo tie-in** | Near 1:1 with Odoo HR/Payroll: `hr.employee`, `hr.contract`, `resource.calendar`, `hr.leave` / `hr.leave.allocation`, `hr.payroll.structure`, `hr.salary.rule`, `hr.payslip`. Very clean. |

### PS2 — Urban Furniture: Accounting System

| Dimension | Content |
|---|---|
| **Core ask** | A double-entry accounting system: master data (Contacts, Products, Chart of Accounts, Journals), transaction flows (PO to Vendor Bill to Payment; SO to Customer Invoice to Payment), analytic accounts and budgets, and three reports generated from the ledger — Balance Sheet, P&L, Budget Report. |
| **Explicit must-haves** | Contact master (Customer/Vendor/Both); Product master (Goods/Service/**Combo**); Chart of Accounts (Asset/Liability/Expense/Income/Capital); Journals (Sales/Purchase/Bank/Cash) with default accounts; Journal Entries with debit/credit items; PO to Bill to payment registration; SO to Invoice with tax to payment; analytic accounts; budgets (period, planned amount, responsible person); Balance Sheet, P&L, Budget Report over a selected period; **Contact portal user** who sees only their own invoices/bills and can pay. |
| **Nice-to-haves** | Profile images on contacts; combo product type; archive (not delete) master data; portal self-service payment; report period selection; a "System" actor that validates data and computes taxes automatically. |
| **Implied expectations a judge assumes** | **Every journal entry balances (sum of debits = sum of credits)** — enforced, not hoped for. Ledger lines are append-only/immutable. Partial payments and outstanding balances tracked correctly. Reports **derived live from the ledger**, never from stored running totals. Portal user cannot see another contact's invoices (IDOR). Period locking. |
| **AI/ML fit** | Weakest of the three. Plausible: auto-suggest the CoA account for a transaction line (text classification over description history), cash-flow forecast from ledger history, budget-variance anomaly alerts. All feel appended rather than intrinsic. |
| **Odoo tie-in** | 1:1 with Odoo Accounting: `res.partner`, `product.template`, `account.account`, `account.journal`, `account.move` / `account.move.line`, `account.analytic.account`, budgets. Smallest, tightest mapping. |

### PS3 — DealFlow360: Sales Operations

| Dimension | Content |
|---|---|
| **Core ask** | A "self-governing deal engine": a quotation builder that enforces pricing discipline via a **blended discount risk score** driving multi-level approval routing, reacts to live stock via multi-warehouse fulfillment splitting, reconciles one-time and recurring lines on one order, and exposes a real customer-facing portal for negotiation — with a deal-health/anomaly dashboard over the top. |
| **Explicit must-haves** | Internal auth plus separate customer portal auth; products, variants, price lists (tier-based); discount ceilings **per customer tier AND per product category**; configurable approval chain (Manager only vs Manager then Finance); blended risk score computation; full audit log (user, timestamp, reason) on every approval/rejection/edit; warehouses with stock, replenishment, and **shipping-cost weighting** used by auto-split; subscription plans with proration, cancellation, partial-refund rules; quotation builder with **live margin indicator**; approval screen; fulfillment split screen with manual override and backorder consolidation prompt; hybrid billing screen with billing schedule; portal negotiation (line comments, counter-discount) that **automatically re-enters approval** if terms breach thresholds; deal-health dashboard (stalled deals, discount anomalies, delivery slippage) with click-through and nudge/escalation; reporting with Period / Rep / Approval Status / Product filters; PDF and XLS export. |
| **Nice-to-haves (explicitly flagged as such in the PS)** | **A6 Upsell/Cross-sell rule setup is marked "(Optional)"**; multi-currency and multi-company are marked "bonus, not a requirement". Softer ones: promoted-product ranking, minimum margin thresholds on suggestions, automated nudge actions, the "Reload Data" / "Close Workspace" workspace controls. |
| **Implied expectations a judge assumes** | The portal must be a **genuinely restricted view** — the PS says this outright — meaning token/session scoping and no internal data leakage. Stock reservation must be concurrency-safe. Quotes must version or snapshot across negotiation rounds. The approval state machine must permit legal transitions only. Audit log immutable. |
| **AI/ML fit** | **Intrinsic and specified.** The PS describes the blended risk score in prose but deliberately leaves the *formula* to us — an explicit invitation to design and defend a scoring function. Upsell ranking is classic market-basket association (co-occurrence to lift), buildable from scratch with no ML library and fully explainable. Two defensible algorithmic features, zero black box. |
| **Odoo tie-in** | Odoo Sales + Inventory + Subscriptions + Portal: `sale.order`, `product.pricelist`, `stock.warehouse` / `stock.quant`, subscription plans, `portal.mixin`. Strong. |

---

## Step B — Rubric scores (1-5, higher = better)

### 1. Feasibility in ~10-12 build hours from scratch

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **2** | Ten interlocking modules, five distinct roles, PDF generation, bulk email, and a live dashboard. The salary-rule engine alone is a ~3h subsystem; the time-off allocation ledger another ~2h. We would ship perhaps 65%, and the missing 35% is visible. |
| Urban Furniture | **4** | Smallest surface by a wide margin: four master entities, two transaction flows that converge on one ledger, three reports. The ledger is a single well-understood abstraction that both flows reuse. Genuinely finishable with polish time remaining. |
| DealFlow360 | **2** | Largest surface: seven backend config modules, nine frontend screens, and a separate portal application. Subscriptions-with-proration and warehouse-splitting are independent multi-hour subsystems that share almost no code. |

### 2. Demonstrable "from scratch" depth

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **5** | Sequenced salary-rule engine with formula evaluation, period-correct contract resolution, and an allocation-consumption ledger. Emphatically not CRUD. |
| Urban Furniture | **4** | The depth is real but *concentrated in one idea*: double-entry with a hard debit-equals-credit invariant and reports computed live from journal lines. That single idea is the best whiteboard moment of the three — but it is one idea, where the others have several independent hard subsystems. Worth noting: **depth per build-hour is the best of the three.** |
| DealFlow360 | **5** | Four independent pieces of genuine algorithmic work: risk scoring, approval state machine, warehouse split under a shipping-cost objective, and proration math. None of it is reachable by scaffolding. |

### 3. AI-explainability potential

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **3** | Anomaly detection on attendance or payslip deltas is defensible but visibly *added on*. A judge asking "why did this need AI?" gets a weak answer. |
| Urban Furniture | **2** | Weakest. Account auto-classification is a nice touch, but an accounting system's whole value proposition is determinism — introducing a probabilistic component invites "why would I want my ledger guessed at?" |
| DealFlow360 | **5** | The PS *asks us to design an algorithm* and explains the intent without giving the formula. We can define every term, justify every weight, demonstrate failure modes, and show the fallback. The upsell ranker is co-purchase lift — countable, inspectable, no library. This is the strongest available answer to "explain your AI and its failure modes." |

### 4. Differentiation ceiling

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **3** | HR/payroll is a well-trodden hackathon build. Our real edge — the rule engine — is hard to make legible in a five-minute demo. Middling pick rate, middling ceiling. |
| Urban Furniture | **4** | Likely the **least-picked** of the three (it reads as dull), which is an advantage in an 800-team field. Most teams that do pick it will fake reports from stored totals; a Balance Sheet that provably balances because it is summed from the ledger is a genuine "they actually did it right" moment. Ceiling capped by an unexciting demo. |
| DealFlow360 | **4** | Highest wow ceiling — live margin updates, automatic approval routing, a real customer portal. But almost certainly the **most-picked** PS, so we are judged against a crowded field. Differentiation must come from finishing precisely the parts others will fake: real portal isolation, real split logic, real proration. |

### 5. Nice-to-have coverage feasibility

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **2** | Long tail (attendance health, overtime, coverage percentage, employee-type filters, bulk email). Most get cut — and the PS buries them in prose exactly where judges will look. |
| Urban Furniture | **4** | Short, cheap list: archiving, combo products, portal payment, report period selection. We could ship nearly all of it. |
| DealFlow360 | **2** | The *must*-haves already overflow the budget, so nice-to-haves realistically get cut wholesale — even though the PS conveniently pre-marks A6 and multi-currency as optional. |

### 6. Team-fit

Team profile: **two strong full-stack developers, little to no ML/AI experience.** Both facts move the ranking, and they move it in the same direction.

| PS | Score | Reasoning |
|---|---|---|
| PeoplePay360 | **3** | Full-stack parallelism helps, but nothing about this team specifically unlocks payroll's scope problem. Already eliminated on other grounds. |
| Urban Furniture | **3** | Urban's headline advantage was a small UI surface — but that advantage only matters to a team whose frontend is the bottleneck, and ours isn't. Two full-stack devs *neutralise* Urban's main edge. Worse, the ML answer hurts here specifically: Urban's only credible AI angles (CoA account classification, cash-flow forecasting) genuinely want a trained model, and a rule-based "guess the account" is unimpressive on stage. Its AI score of 2 cannot be rescued by this team. |
| DealFlow360 | **5** | Two full-stack devs means **two independent vertical slices running in parallel**, which attacks DealFlow's one real weakness — screen count — head-on. And low ML familiarity is *not* a penalty here: both of DealFlow's algorithmic features are arithmetic we design ourselves (weighted per-line overage aggregation; co-occurrence lift ranking). No training, no model, no library. That also satisfies the Understand > Impress rule better than a trained model would — we will be able to justify every coefficient on stage. |

### Final totals

| PS | 1. Feasibility | 2. Depth | 3. AI | 4. Differentiation | 5. Nice-to-haves | 6. Team-fit | **Total** |
|---|---|---|---|---|---|---|---|
| PeoplePay360 | 2 | 5 | 3 | 3 | 2 | 3 | **18** |
| Urban Furniture | 4 | 4 | 2 | 4 | 4 | 3 | **21** |
| **DealFlow360** | 2 | 5 | 5 | 4 | 2 | 5 | **23** |

---

## Step C — Verdict (FINAL)

### PeoplePay360 is eliminated.

Not because it is bad — the rule engine is legitimately the most interesting business logic across all three — but because it is **strictly dominated**. It carries DealFlow360's scope burden with Urban Furniture's demo excitement level, and gets neither DealFlow's intrinsic AI story nor Urban's finishability. There is no configuration of a two-person, eleven-hour build where it is the right pick.

### The real choice was Urban Furniture vs DealFlow360 — tied at 18 before team-fit, broken 23 to 21 by it.

They tied because they are opposite bets:

- **DealFlow360 is the finalist bet.** It is the only PS where the AI feature is *intrinsic and specified rather than bolted on* — which matters enormously, because in an 800-team field the AI-explainability question is where most teams collapse. The risk is real: we will not finish all of it, and a visibly incomplete build reads worse than a complete smaller one.
- **Urban Furniture is the completion bet.** It is the only PS we can plausibly finish, polish, security-test, and seed inside the timeline contract — with nice-to-haves shipped and a provable correctness invariant to demo. The risk is executing flawlessly on something a judge finds unmemorable, with a thin AI answer.

### Decision: **DealFlow360**, under a hard scope contract.

The team profile broke the tie decisively, and it did so for two independent reasons:

1. **Two full-stack developers directly neutralise DealFlow's only real weakness.** Its feasibility score of 2 is driven almost entirely by screen count and subsystem breadth — precisely the problem that two people running independent vertical slices in parallel is built to solve. Urban Furniture's compensating advantage (a tiny UI surface) is worth nothing to a team that isn't frontend-bound.
2. **Low ML familiarity is neutral-to-positive for DealFlow and actively bad for Urban.** DealFlow's two algorithmic features are arithmetic we design and can defend line by line — no model, no training data, no library, no black box. Urban's AI options genuinely want a trained classifier or forecaster; without one, its weakest criterion stays weak.

Stated as we would defend it to a judge:

> We chose DealFlow360 over Urban Furniture and PeoplePay360 because it was the only problem statement where the intelligent component was intrinsic to the problem rather than bolted onto it. The statement describes the blended discount risk score in prose and deliberately leaves the formula to the team — so the algorithm is something we designed and can fully justify, not something we imported. PeoplePay360 we eliminated early: it carries DealFlow's scope with none of its differentiation. Urban Furniture was the safe pick and we took it seriously — a correct double-entry ledger is genuinely harder than it looks — but its value is in a single invariant, and our team was not constrained in the way that would have made its smaller scope pay off.

**Scope contract** — committed up front in `PRD.md`, tiered rather than flat:

- **MVP (must finish):** internal auth plus portal auth; products and price lists; discount tiers per customer tier *and* per category; **blended risk score**; approval chain with audit trail; quotation builder with live margin; customer portal negotiation with automatic approval re-entry.
- **Should-have (build only if MVP lands by ~16:00):** multi-warehouse split with manual override; deal-health dashboard.
- **Cut unless time appears:** subscriptions and proration; XLS export; backorder consolidation; the upsell panel — noting the PS itself marks upsell rule *setup* optional, and that the panel is a cheap, high-visibility win if the co-purchase data model already exists.

That contract keeps the two things judges probe hardest — the algorithm we designed, and the portal the PS explicitly warns must be genuinely restricted — inside the must-finish set.

That contract keeps the two things judges probe hardest — the algorithm we designed, and the portal the PS explicitly warns must be genuinely restricted — inside the must-finish set.

---

## Re-baselined timeline

Phase 0 finished at 10:30 against a 09:45 contract deadline — **45 minutes over, on top of a start that was already ~60 minutes late.** The slip is absorbed by compressing the two documentation phases rather than by cutting the build window, which stays at its full 8 hours.

| Window | Phase | Deliverable | Change vs original contract |
|---|---|---|---|
| 10:30 | Phase 0 close | `DECISION.md` | 45 min over |
| 10:30–11:15 | Phase 1 — PRD | `PRD.md` | **compressed 60 → 45 min** |
| 11:15–12:00 | Phase 2 — Architecture | `TRD.md`, `DB_SCHEMA.md`, `design.md` | **compressed 60 → 45 min** |
| 12:00–20:00 | Phase 3 — Build (vertical slices) | working code, `PHASE_LOG.md` | **unchanged, 8h** |
| 20:00–21:00 | Phase 4 — Integration | end-to-end wiring | unchanged |
| 21:00–22:30 | Phase 5 — Security & failure testing | `TEST_LOG.md`, `SECURITY_REVIEW.md` | unchanged |
| 22:30–23:30 | Phase 6 — Polish | demo-ready build | unchanged |
| 23:30–00:00 | Buffer — bug triage only | — | unchanged |

**Assumption flagged:** this assumes a midnight submission deadline, carried over from the original contract. If the real deadline differs, tell me now — it changes the scope contract, not just the schedule.

**Timeline risk:** the compression only works if Phases 1 and 2 stay lean. Both docs will be written to be decision-recording, not exhaustive.

---

## Risks accepted with this choice

| Risk | Mitigation |
|---|---|
| Largest scope of the three; we will not ship 100% of the PS | Tiered scope contract above; Should-have tier is a hard gate at 16:00, not a hope |
| Likely the most-picked PS — crowded comparison field | Differentiate by finishing what others fake: genuinely isolated portal, real split logic, real audit trail |
| Nine frontend screens plus a portal | Two full-stack devs running parallel vertical slices; shared component system agreed in `design.md` before build starts |
| Portal is the single largest security surface (IDOR, token scoping, data leakage) | Portal isolation is an explicit Phase 5 checklist item, not a general "we'll test auth" |

---

## Overrides / decisions log

| # | Decision | Made by | Reasoning |
|---|---|---|---|
| 1 | PeoplePay360 eliminated before scoring completed | Claude, unchallenged | Strictly dominated — DealFlow's scope with Urban's ceiling |
| 2 | DealFlow360 selected over Urban Furniture | Team, on recommendation | Team-fit (full-stack parallelism + rule-based AI) broke an 18–18 tie |
| 3 | Timeline slip absorbed from doc phases, not the build window | Claude | Build hours are the scarce resource; docs are compressible without affecting the demo |
| 4 | **Scope contract in §Step C overridden — full PS coverage, nothing cut, including all nice-to-haves** | **Team** | Team confirmed all-night availability, raising the build window from ~8h to ~13.5h. The tiered contract was calibrated to the shorter budget; with the longer one, full coverage is defensible. Tier labels P0/P1/P2 now denote build order only. See `PRD.md` §2. |
| 5 | Multi-currency / multi-company held at BONUS tier | Claude, pushback recorded, not overruled | The PS classifies these itself as *"bonus, not a requirement"* — a distinct category from a nice-to-have. Team may promote at any time. Note A2.3's per-price-list currency rules remain in scope as a must. |
| 6 | Project relocated from the disposable scratch workspace to `D:\Dealflow` | Team | Scratch workspace does not survive the session — unacceptable for a 24h build |

