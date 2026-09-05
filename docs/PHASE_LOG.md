# PHASE_LOG.md

Running log — one entry per phase, slice, or material decision. Timestamped.

---

## 2026-09-05

### 10:20 — Phase 0 opened (late)

Three problem statements received as PDFs. Text extracted with `pdftotext` after image rendering failed; all three read in full including DealFlow360's section 10, which was truncated on first pass.

**Status vs contract:** contract assumed a 09:00 start with Phase 0 closing at 09:45. Actual Phase 0 work began ~10:20. Running ~80 min late before any analysis.

### 10:20 — Phase 0, Steps A + B complete

`DECISION.md` written: structural extraction for all three PS (core ask, must-haves, buried nice-to-haves, judge-implied expectations, AI fit, Odoo mapping), plus rubric scoring on criteria 1–5 with per-score reasoning.

- PeoplePay360: 15 — eliminated as strictly dominated
- Urban Furniture: 18
- DealFlow360: 18

Criteria 1–5 produced a genuine tie. Criterion 6 (team-fit) posed to the team as a real tiebreaker rather than a formality — DealFlow360 requires nine frontend screens plus a portal, which flips the answer if frontend throughput is the constraint.

### 10:30 — Phase 0 closed. Decision: **DealFlow360**

Team profile returned: two strong full-stack developers, little to no ML/AI experience. Both facts favour DealFlow360 independently —

1. Full-stack parallelism attacks DealFlow's only real weakness (breadth) directly, and neutralises Urban Furniture's only compensating advantage (small UI surface).
2. Low ML familiarity is neutral-to-positive for DealFlow, whose algorithmic features are hand-designed arithmetic, and actively bad for Urban, whose AI options want a trained model.

Final: DealFlow360 **23**, Urban Furniture 21, PeoplePay360 18.

**Deferred / cut at this stage:** subscriptions and proration, XLS export, backorder consolidation, upsell panel — all pushed below the MVP line in the scope contract, to be formally recorded with Include/Defer/Cut reasoning in `PRD.md`.

**Phase 0 budget:** 45 min over contract, on top of an ~80 min late start.

### 10:30 — Timeline re-baselined

Slip absorbed by compressing Phase 1 (60 → 45 min) and Phase 2 (60 → 45 min). **Phase 3 build window preserved in full at 8 hours (12:00–20:00).** Rationale: build hours are the scarce resource; documentation is compressible without affecting what gets demoed.

Assumption flagged for confirmation: midnight submission deadline, carried over from the original contract.

### 10:40 — Project moved to `D:\Dealflow`

Out of the disposable scratch workspace. `DECISION.md` and `PHASE_LOG.md` carried over. All further work happens here.

### 10:40 — SCOPE OVERRIDE (team decision)

Team overrode the tiered scope contract from `DECISION.md` §Step C: **full problem-statement coverage, including every nice-to-have. Nothing cut. No features invented beyond the PS.**

Team also confirmed availability to work through the night, which is what makes this feasible — the override would not have been sound against the original midnight assumption.

**Claude's single recorded pushback:** multi-currency and multi-company are described by the PS itself as *"bonus, not a requirement"* — a different category from a nice-to-have. Classified as BONUS tier, built only after P0–P2 are green. Related but distinct: A2.3's "currency specific rules" on price lists **is** in scope as a must. Interpretation recorded in `PRD.md` §5.D; team can promote D1/D2 at any time.

Consequence: the tier labels P0/P1/P2 now mean **build order only**, not a cut list. `PRD.md` §9 (cut list) is deliberately empty.

### 11:25 — Phase 1 complete: `PRD.md`

Full requirement traceability to the PS — every lettered module A1–A7 and B1–B9 decomposed into numbered requirements, each with a tier and a judge-verifiable success criterion. 62 requirements total.

Three findings worth logging:

1. **Three requirements exist that no lettered module states.** PS §9's acceptance walkthrough ends with *"record a payment, and check that the invoice status updates correctly"*, and PS §3 gives Finance *"reconciles recurring billing and credit notes"* — so invoicing, payment recording with status transitions, and credit notes are all requirements hidden outside the module breakdown. Captured as C1–C3. These are exactly the kind of buried requirement the master prompt warns about, and a team reading only §4 would ship without them and fail the PS's own test flow.
2. **The blended risk score needs two statistics, not one.** PS §10 sets two requirements that a single number cannot satisfy simultaneously: one badly-over line must flag the whole order, *and* many mildly-over lines must aggregate. Specified as value-weighted blended score `S` plus worst-line severity `M`, routed on both. Reasoning recorded in `PRD.md` §6.1.
3. **PS §9 is a free acceptance test.** Its eight steps are adopted verbatim as the release gate rather than inventing our own.

**Phase 1 budget:** 45 min allotted, ~45 min used. On budget.

### 11:25 — Timeline re-baselined again (all-night availability)

Assumption: submission 09:00 tomorrow, 24h from a 09:00 start. **Flagged as an assumption — needs confirmation.**

| Window | Phase |
|---|---|
| 11:25–12:25 | Phase 2 — Architecture (`TRD.md`, `DB_SCHEMA.md`, `design.md`) |
| 12:25–02:00 | Phase 3 — Build, vertical slices (**~13.5h**) |
| 02:00–03:30 | Phase 4 — Integration pass |
| 03:30–05:30 | Phase 5 — Security & failure testing |
| 05:30–07:00 | Phase 6 — Polish |
| 07:00–08:00 | Phase 7 — Demo video |
| 08:00–09:00 | Buffer — bug triage only, no new features |

13.5 build hours across two full-stack developers is what makes full PS coverage defensible. It is still aggressive: 62 requirements including a separate portal application. It holds only with strict slice discipline and a shared component system agreed in `design.md` **before** any UI is written — otherwise the frontend fragments and the last four hours go to reconciliation instead of features.

### 11:45 — Stack decided (three team calls)

| Call | Decision | Note |
|---|---|---|
| Database | **PostgreSQL** (team, overriding Claude's SQLite recommendation) | Better concurrency correctness — real `SELECT … FOR UPDATE` row locking for stock. Costs judge-setup friction against the website's offline criterion; mitigated by Docker Compose + one-command setup, documented in `TRD.md` §2.3. |
| Styling | **Tailwind** (build-time, not CDN) approved by team | Buys ~2h across 22 screens. Design tokens still ours — six spacing steps, four type sizes, state-only colour — defined in `tailwind.config.js`. Not a component kit, so the master prompt's no-UI-kit rule holds. |
| Validation | **Custom validator, no Zod** (team) | Rationale accepted: a large third-party validation dependency reads as a red flag to judges. ~150 lines, zero deps, spec in `TRD.md` §6. |

Remaining stack: TypeScript both ends · Express · raw SQL via `pg` (no ORM) · React + Vite (two entry points) · SSE for real-time · Argon2id + opaque DB-backed sessions · `node:test` · pdfkit for PDF · **our own xlsx writer** via stdlib `node:zlib`.

**Runtime dependency count: 6** (express, pg, argon2, pdfkit, react, react-dom) plus 3 dev (typescript, vite, tailwindcss).

### 11:50 — Wireframe received and analysed → `WIREFRAME_NOTES.md`

The Excalidraw file from the PS was parsed (1318 elements, 19 frames). It is far more specific than the PS prose and materially changes the build.

**The finding that changes the schedule.** The wireframe's own Navigation Key states: *"Each module has one list screen (all records) and one detail screen (one record, opened by clicking a row)."* Five modules — Quotations, Approvals, Fulfillment, Subscriptions, Invoices — are therefore **the same two screens configured five ways.** The frontend is not 16 bespoke screens; it is two shells plus six special screens. This retires the frontend-fragmentation risk flagged at 11:25 and is what makes full PS coverage credible in the remaining window.

**Nine requirements added that the PS text does not state** (all Include, per the scope directive):

- **C4 — invoicing is gated on shipment.** Screen 13: *"Partial invoicing stays reconciled with partial delivery, nothing is billed before it ships."* A real business rule, not derivable from the PS text. Enforced structurally: an invoice line carries a `shipment_id`.
- B10.1 Sales Dashboard home (screen 2 — the PS never mentions a home screen)
- B10.2 Quotations render as stage-grouped cards with a Switch to Table View toggle — this is how the PS's "Pipeline Kanban" and the wireframe's list reconcile into **one** screen rather than two
- B8.7 portal Requested Delivery Date · B8.8 portal has its own nav shell
- A2.4 product archive · A2.5 price-list rules are formulas · A2.6 Subscription Yes/No reveals interval
- B9.6 nudges and escalations persist as records

**Rules the wireframe pins down that the PS left open:** the LOW/MEDIUM/HIGH → none/manager/manager+finance routing table (screen 18), the Submitted→Manager→Finance→Confirmed stepper (screen 6), and confirmation that discount checking is live per-line as typed, not at submit (screen 4).

Screen 6 independently confirms the two-statistic design from `PRD.md` §6.1: *"Worst single line (8pt over) plus overall pattern across the order sets the blended score."*

Noted: frames 16/17 contain stray JavaScript test snippets — accidental paste artifacts in the source file, ignored.

### 12:35 — Phase 2 complete: `TRD.md`, `DB_SCHEMA.md`, `design.md`

**Schema:** ~35 tables. Load-bearing decisions —

- **Customers are a separate table from internal users**, not `role='customer'`. With one table, every internal authorization check is one forgotten `WHERE role != 'customer'` from leaking. With two, a portal identity has no representation the internal system can express. Same reasoning splits `sessions` / `portal_sessions`. This is the structural reading of PS §7.
- **`GET /portal/quotation` takes no identifier** — the resource is a function of the session. The IDOR class of bug does not exist on that route rather than being defended against on it.
- **Price and cost are snapshotted onto quotation lines.** If lines joined to products for price, an admin editing a price would silently rewrite the value of every historical quotation including approved ones — making the audit trail a false record.
- **`cost_cents` on products** — without it there is no margin, and B3.4, B5.2 and A6.3 are all unimplementable. Cheap now, expensive at hour nine.
- **`available` stock is never stored**, only `on_hand` and `reserved`. A third number that can disagree with the other two is a bug class we decline to have. `CHECK (reserved <= on_hand)` is the oversell backstop at the DB level.
- **`UNIQUE(subscription_id, period_start)`** makes the billing sweep idempotent by construction — a retry cannot double-bill.
- **Audit log append-only via table grants**, not convention: the app role holds INSERT/SELECT only.

**Integrity split recorded:** the database enforces what must never be violated regardless of code path; the application enforces what is policy and therefore configurable. Row-level security was considered and rejected — with 4 roles × ~40 endpoints, RLS policies are harder to audit under time pressure than explicit middleware a judge can read.

**Phase 2 budget:** 45 min allotted, ~70 min used (**25 min over**). Cause: the wireframe arrived mid-phase and warranted a full analysis pass. Judged worth it — it removed a schedule risk and found nine requirements we would otherwise have missed. Absorbed from the Phase 3 window, which is now 12:35–02:30 (~13.9h).

### 12:35 — Repository initialised

`git init` on `main`. Skeleton per `TRD.md` §9: `docs/ db/ server/ shared/ web/ portal/ tests/`. `.gitignore` and `.env.example` written; `.env` never committed.

Phase 2 docs staged but **deliberately not committed** — the website grades *"one member managing the repo is not enough"*, so the first commits should come from both developers on their own machines rather than from one tooling session.

### Open items

- [x] ~~Decide project directory~~ → `D:\Dealflow`
- [x] ~~Team sign-off to open Phase 1~~
- [x] ~~Confirm submission deadline~~ → **10:00 AM tomorrow**
- [x] ~~Stack decisions~~ → Postgres / Tailwind / custom validator
- [ ] **Both devs make their first commit** before build starts — graded criterion
- [ ] Confirm BONUS tier (D1/D2) stays out of the main build
- [ ] Team sign-off on Phase 2 docs → open Phase 3
