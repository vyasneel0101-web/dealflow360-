# PHASE3_PLAN.md — parallel build plan

**Window:** 12:45 → 02:30 (~13.75h) · **Two tracks, running simultaneously** · 10 slice pairs

Track A and Track B work on **disjoint files** by design (`TRD.md` §9 layout). Neither waits on the other: the frontend builds against `shared/types.ts`, not against a running API.

| | Track A — Dev A (Pratham) | Track B — Dev B |
|---|---|---|
| Owns | `db/migrations/` · `server/services/` · `server/repositories/` · `server/lib/` | `web/src/` · `portal/src/` · `server/routes/` |
| Domain | schema, auth, business logic, algorithms | design system, screens, both SPAs |
| Branch prefix | `slice/NNa-*` | `slice/NNb-*` |

**Contract rule:** Track A writes new shapes into `shared/types.ts` **first and pushes immediately**, before implementing them. Track B builds against the type even while the endpoint returns nothing. That is what keeps the tracks independent.

---

## Slice 1 — Foundation · 12:45–14:00

**A — `slice/01a-schema-auth`**
- Migrations 001–004: identity, customers/tiers, products/pricing, warehouses/stock (`DB_SCHEMA.md` §2–4)
- `server/lib/validate.ts` — the custom validator (`TRD.md` §6)
- `server/lib/errors.ts`, `crypto.ts`, `money.ts`
- Argon2id hashing; `sessions` + `portal_sessions` as **two realms**; `requireInternal` / `requirePortal` / `requireRole`
- `POST /auth/signup|login|logout`, `GET /auth/me`
- **Push `shared/types.ts` v1 within the first 30 minutes** — auth + core entity shapes
- Test: password never stored plaintext; portal token rejected by internal middleware

**B — `slice/01b-design-system`**
- Vite × 2 entry points (`web/`, `portal/`), TypeScript, Express static wiring
- `tailwind.config.js` — tokens exactly per `design.md` §2: six spacing steps, four type sizes, state-only colour
- Components: `Badge` `KpiChip` `DataTable` `FilterBar` `Stepper` `SectionCard` `ActionBar` `Field` `Money` `Percent` `RiskBadge` `EmptyState` `Toast`
- `<ListScreen>` and `<DetailScreen>` shells (`design.md` §1)
- Screen 1 — Login / Signup, wired to real auth once A pushes
- App shell: nine-item nav + utility cluster

> Slice 1 is the only slice where B is partly building on stubs. Everything after this consumes real endpoints.

---

## Slice 2 — Catalogue · 14:00–15:15

**A — `slice/02a-catalogue`** · products/categories/variants/price-lists CRUD · `services/pricing.ts` with the three-step resolution order · archive (A2.4) · price-list formula rules (A2.5) · seed script v1
**B — `slice/02b-product-screens`** · Screen 16 Product dashboard · Screen 17 Product detail + variants + pricelists · Screen 18 Discount tiers & approval chain config

---

## Slice 3 — The core · 15:15–16:45 ⭐

The most important 90 minutes of the night. This is the demo.

**A — `slice/03a-risk-engine`** · `services/risk.ts` — `S`, `M`, band, per-line ceiling/overage (`TRD.md` §5.1) · quotation + line CRUD where **every mutation returns the fully recomputed quotation** · `approval_chain_rules` seeded and read from DB · unit tests against the PS §10 worked example
**B — `slice/03b-quotation-builder`** · Screen 3 Quotations, stage cards + table toggle · Screen 4 builder: line table with live `Discount / Limit / Status`, debounced 300ms, margin + risk summary rail

---

## Slice 4 — Approvals · 16:45–18:00

**A — `slice/04a-approvals`** · `services/approval.ts` state machine · `approval_requests` + `approval_steps` · Finance step inserted only when band requires · `services/audit.ts` append-only · submit → route or auto-confirm
**B — `slice/04b-approval-screens`** · Screen 5 Approvals list · Screen 6 Approval detail: stepper, "Why This Quote Was Flagged" table, audit trail, Approve / Return / Reject with required note

---

## Slice 5 — Fulfillment · 18:00–19:30

**A — `slice/05a-fulfillment`** · greedy split under shipping-cost weighting · `SELECT … FOR UPDATE` reservation in deterministic lock order · backorders · orders
**B — `slice/05b-fulfillment-screens`** · Screen 7 stock + orders list · Screen 8 split detail, Accept / Manual Override · Screen 2 Sales Dashboard (KPIs + recent activity from audit log)

---

## Slice 6 — Billing · 19:30–21:00

**A — `slice/06a-billing`** · subscriptions, `billing_schedule` with idempotent unique · proration · cancel → credit note · invoices + payments with derived status · **C4 shipment-gated invoicing**
**B — `slice/06b-billing-screens`** · Screen 9 Subscriptions · Screen 10 Billing detail (one-time vs recurring, schedule, proration history) · Screen 12 Invoices · Screen 13 Invoice detail with stepper + Record Payment

---

## Slice 7 — Portal · 21:00–22:30 ⭐

The PS's flagship requirement and the biggest security surface.

**A — `slice/07a-portal-api`** · magic links (single-use, scoped, expiring) · `GET /portal/quotation` **taking no id** · comments, negotiation · confirm → re-evaluate risk → **automatic re-entry into approval (B8.6)**
**B — `slice/07b-portal-spa`** · Screen 11 in `portal/` as a separate bundle · own three-item shell · line comments, Counter Discount %, Requested Delivery Date · calmer density, no internal vocabulary

---

## Slice 8 — Intelligence · 22:30–00:00

**A — `slice/08a-intelligence`** · `product_affinity` lift computation + cold-start fallback · deal health detection (stalled / anomaly vs rep average / slippage) · nudges + escalation · **write `AI_EXPLAINABILITY.md`**
**B — `slice/08b-intelligence-screens`** · Upsell panel in the builder: margin delta, promo tag, Add / Dismiss, immediate margin update · Screen 14 Deal Health with click-through and inline actions

---

## Slice 9 — Reporting & real-time · 00:00–01:15

**A — `slice/09a-reports`** · report aggregation with all four filters · PDF via pdfkit · **our own XLSX writer** via `node:zlib` · SSE hub
**B — `slice/09b-reports-realtime`** · Screen 15 Admin Reporting · SSE subscription across screens · Reload Data / Go to Back-end / Close Workspace

---

## Slice 10 — Completion sweep · 01:15–02:30

**Both, pairing.** Remaining nice-to-haves and the gaps that appear only when everything is connected.
- B6.4 backorder consolidation prompt · B9.6 persisted nudge outcomes · B1.2–B1.4 verification
- Seed enrichment: **~40 historical confirmed quotations** — without them the upsell panel is empty and discount-anomaly detection has no baseline
- Empty / loading / error state pass across all 22 screens (`design.md` §5)
- Walk PS §9's eight-step test flow end to end

---

## Rebalancing

Run this at every slice boundary:

```bash
git shortlog -sn
```

Track B has more screens; Track A has harder logic — commit counts should land roughly even. If it drifts past ~70/30 by Slice 5, swap a slice: the natural trade is A taking screens 12/13 in Slice 6, or B taking the reports aggregation in Slice 9.

## Falling behind

If a slice runs more than 25% over, stop and say so — do not grind. The tradeable time is Slice 10, then Slice 9's XLSX writer (PDF alone still satisfies A7.6). **Slices 3, 4 and 7 are not tradeable** — they are the demo.
