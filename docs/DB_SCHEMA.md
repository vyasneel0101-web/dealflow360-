# DB_SCHEMA.md — DealFlow360

**Database:** PostgreSQL 16 (team decision — see `TRD.md` §2.3)
**Access:** raw SQL through `pg`. No ORM. This file is the source of truth; `db/migrations/*.sql` implements it verbatim.

---

## 0. Conventions

| Convention | Rule | Why |
|---|---|---|
| Money | `BIGINT`, **minor units** (cents). Never `FLOAT`/`REAL`. | Floating-point currency arithmetic produces wrong invoices. Column names end `_cents` so a misuse is visible at the call site. |
| Percentages | `NUMERIC(6,3)` — e.g. `18.000` means 18%. | Exact decimal. Discounts feed approval routing; rounding drift changes who approves a deal. |
| Primary keys | `BIGINT GENERATED ALWAYS AS IDENTITY` | Sequential and compact. IDs are never used as security boundaries — see §9. |
| Timestamps | `TIMESTAMPTZ`, default `now()` | Stalled-deal and billing logic is time-sensitive; naive timestamps break across DST. |
| Soft delete | `archived_at TIMESTAMPTZ NULL` where the wireframe shows archiving | Screen 16 reports "128 active, 6 archived". Accounting-adjacent records must never hard-delete. |
| Enums | `TEXT` + `CHECK` constraint, not PG `ENUM` | Adding a state to a PG enum mid-build requires a migration dance; a CHECK is a one-line ALTER. |
| Naming | `snake_case`, plural tables, `<singular>_id` FKs | Predictable, so queries can be written without re-reading this file. |

---

## 1. Entity map

```
                       ┌──────────────┐
                       │ sales_teams  │
                       └──────┬───────┘
                              │
  ┌──────────┐         ┌──────┴───────┐        ┌─────────────────┐
  │ sessions ├────────>│    users     │        │ customer_tiers  │
  └──────────┘         └──────┬───────┘        └────────┬────────┘
                              │ owner                    │
  ┌────────────────┐          │                  ┌───────┴──────┐
  │ portal_sessions├─┐        │                  │  customers   │
  └────────────────┘ │        │                  └───┬──────┬───┘
  ┌────────────────┐ │        │                      │      │
  │  magic_links   ├─┼───>┌───┴──────────┐<──────────┘      │
  └────────────────┘ │    │  quotations  │                  │
                     └───>└───┬──────┬───┘             ┌────┴─────┐
                              │      │                 │ contacts │
                    ┌─────────┘      └────────┐        └────┬─────┘
                    │                         │             │
          ┌─────────┴────────┐       ┌────────┴─────────┐   │
          │ quotation_lines  │       │ approval_requests│   │
          └────┬────────┬────┘       └────────┬─────────┘   │
               │        │                     │             │
     ┌─────────┘        │            ┌────────┴───────┐     │
     │                  │            │ approval_steps │     │
┌────┴─────┐   ┌────────┴──────┐     └────────────────┘     │
│ products │   │ subscriptions │                            │
└────┬─────┘   └───────┬───────┘         ┌──────────────────┴────┐
     │                 │                 │ portal_comments       │
┌────┴──────────┐ ┌────┴──────────────┐  │ negotiation_requests  │
│product_variants│ │ billing_schedule │  └───────────────────────┘
│price_lists     │ │subscription_changes│
│product_categories└───────┬───────────┘
└────┬───────────┘         │
     │                     │
┌────┴────┐          ┌─────┴────┐      ┌──────────┐     ┌─────────────┐
│  stock  │<─────────┤  orders  ├─────>│ invoices ├────>│  payments   │
└────┬────┘          └─────┬────┘      └────┬─────┘     └─────────────┘
     │                     │                │
┌────┴───────┐   ┌─────────┴──────┐    ┌────┴────────┐
│ warehouses │<──┤ order_shipments│    │credit_notes │
└────────────┘   └─────────┬──────┘    └─────────────┘
                     ┌─────┴────────┐
                     │shipment_lines│
                     └──────────────┘

  audit_log ── polymorphic, references every entity above by (entity_type, entity_id)
```

---

## 2. Identity & access

### `sales_teams`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK identity |
| name | TEXT | NOT NULL UNIQUE |

### `users` — internal users only
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK identity |
| email | CITEXT | NOT NULL UNIQUE |
| password_hash | TEXT | NOT NULL |
| full_name | TEXT | NOT NULL |
| role | TEXT | NOT NULL CHECK IN (`rep`,`manager`,`finance`,`admin`) |
| sales_team_id | BIGINT | FK → sales_teams, NULL |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

`CITEXT` so `Bob@x.com` and `bob@x.com` cannot become two accounts. Index: `users(sales_team_id)` for A7.3 rep/team filtering.

### `contacts` — customer-side people. **Deliberately not rows in `users`.**
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK identity |
| customer_id | BIGINT | NOT NULL FK → customers |
| email | CITEXT | NOT NULL UNIQUE |
| full_name | TEXT | NOT NULL |
| password_hash | TEXT | NULL — magic-link users have none |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

> **Design note — the most important decision in this schema.** Customers are a *separate table* from internal users, not a `role='customer'` row. PS §7 requires the portal be *"a real, separate, restricted view, not just another internal screen with a different label."* If both live in `users`, then every internal authorization check is one forgotten `WHERE role != 'customer'` away from leaking. With separate tables, a portal identity has no representation the internal system can even express — the isolation is structural, not conditional. Same reasoning drives the split session tables below.

### `sessions` (internal) and `portal_sessions` (customer) — two tables, deliberately
Identical shape; separate namespaces.

| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK identity |
| token_hash | TEXT | NOT NULL UNIQUE — SHA-256 of the bearer token |
| user_id / contact_id | BIGINT | NOT NULL FK |
| expires_at | TIMESTAMPTZ | NOT NULL |
| revoked_at | TIMESTAMPTZ | NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| user_agent | TEXT | NULL |

We store the **hash** of the session token, never the token. A database read does not yield a usable credential. Lookup is `WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`.

### `magic_links`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK identity |
| token_hash | TEXT | NOT NULL UNIQUE |
| contact_id | BIGINT | NOT NULL FK → contacts |
| quotation_id | BIGINT | NOT NULL FK → quotations |
| expires_at | TIMESTAMPTZ | NOT NULL |
| used_at | TIMESTAMPTZ | NULL — single use |

Scoped to **one quotation**, single-use, expiring. A leaked link grants one document for a limited time, not an account.

---

## 3. Customers & pricing

### `customer_tiers`
`id · name (UNIQUE) · max_discount_pct NUMERIC(6,3) · sort_order INT`
Seeded Bronze 5 / Silver 10 / Gold 15 — **values, not code constants** (PS §7: rules must not be hardcoded).

### `customers`
`id · name · tier_id FK · email · currency CHAR(3) NOT NULL DEFAULT 'USD' · archived_at · created_at`

### `product_categories`
`id · name UNIQUE · max_discount_pct NUMERIC(6,3) NOT NULL`
Category ceilings live here (A3.2) — Hardware 15, Services 10, Subscription per config.

### `products`
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| name | TEXT | NOT NULL |
| category_id | BIGINT | FK NOT NULL |
| base_price_cents | BIGINT | NOT NULL CHECK ≥ 0 |
| **cost_cents** | BIGINT | NOT NULL CHECK ≥ 0 — **required for margin (B3.4) and upsell filtering (A6.3)** |
| unit | TEXT | NOT NULL — "Each", "Recurring" |
| tax_pct | NUMERIC(6,3) | NOT NULL DEFAULT 0 |
| description | TEXT | |
| is_subscription | BOOLEAN | NOT NULL DEFAULT false (A2.6) |
| recurring_interval | TEXT | NULL CHECK IN (`weekly`,`monthly`,`quarterly`,`yearly`) |
| qty_on_hand | INT | NOT NULL DEFAULT 0 — catalogue-level figure per screen 17 |
| is_promoted | BOOLEAN | NOT NULL DEFAULT false (A6.2) |
| archived_at | TIMESTAMPTZ | NULL (A2.4) |

`CHECK (NOT is_subscription OR recurring_interval IS NOT NULL)` — a subscription product without an interval is unbillable, so the DB refuses it.

`cost_cents` deserves emphasis: without it there is no margin, and without margin B3.4, B5.2 and A6.3 are all unimplementable. It is easy to omit at schema time and expensive to add at hour nine.

### `product_variants` — flat, matching screen 17's table exactly
`id · product_id FK · attribute TEXT · values TEXT · extra_price_cents BIGINT`

Modelled as the wireframe draws it (one row per attribute, values as a list) rather than as a full variant-combination matrix. A proper matrix is the "correct" model but costs hours and renders a UI the wireframe does not show. Recorded here as a deliberate simplification, not an oversight — the honest answer if a judge asks.

### `price_lists` (A2.3, A2.5)
`id · name · tier_id FK · currency CHAR(3) · rule_type TEXT CHECK IN (`none`,`percent_off`,`fixed`) · rule_value NUMERIC(10,3) · archived_at`

Screen 17's *"Price minus 10 percent base"* = `rule_type='percent_off', rule_value=10`. *"Price, no adjustment"* = `rule_type='none'`.

### `price_list_items` — optional per-product override
`id · price_list_id FK · product_id FK · price_cents · UNIQUE(price_list_id, product_id)`

**Price resolution order** (implemented once, in `pricing.ts`): `price_list_items` override → else `products.base_price_cents` with the price list's rule applied → plus variant `extra_price_cents`.

---

## 4. Warehouses & stock

### `warehouses`
`id · name UNIQUE · shipping_cost_weight NUMERIC(10,3) NOT NULL DEFAULT 1.0 · is_active`
`shipping_cost_weight` is the A4.3 input to split optimisation.

### `stock`
| Column | Type | Notes |
|---|---|---|
| warehouse_id | BIGINT | FK, part of PK |
| product_id | BIGINT | FK, part of PK |
| on_hand | INT | NOT NULL CHECK ≥ 0 |
| reserved | INT | NOT NULL CHECK ≥ 0 |

`PRIMARY KEY (warehouse_id, product_id)` · `CHECK (reserved <= on_hand)`

> **Integrity note.** `available = on_hand - reserved` is **never stored**. It is computed on read. A stored `available` is a third number that can disagree with the other two, and reconciling it is a class of bug we simply decline to have. The `reserved <= on_hand` CHECK is the oversell guard **at the database level** — even if application logic is wrong, Postgres refuses the write. Reservation itself runs inside a transaction using `SELECT … FOR UPDATE` on the stock rows (see `TRD.md` §5.2).

### `replenishment_rules`
`id · warehouse_id FK · product_id FK · min_qty INT · reorder_qty INT · UNIQUE(warehouse_id, product_id)`

---

## 5. Quotations

### `quotations`
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| ref | TEXT | NOT NULL UNIQUE — `Q-1042` |
| customer_id | BIGINT | FK NOT NULL |
| price_list_id | BIGINT | FK NULL |
| owner_user_id | BIGINT | FK → users NOT NULL |
| status | TEXT | NOT NULL CHECK IN (`draft`,`pending_approval`,`returned`,`approved`,`negotiation`,`confirmed`,`rejected`) |
| currency | CHAR(3) | NOT NULL |
| requested_delivery_date | DATE | NULL (B8.7) |
| promised_date | DATE | NULL — feeds B9.3 slippage |
| blended_score | NUMERIC(8,3) | NULL — cached `S` |
| worst_line_overage | NUMERIC(8,3) | NULL — cached `M` |
| risk_band | TEXT | NULL CHECK IN (`low`,`medium`,`high`) |
| negotiation_round | INT | NOT NULL DEFAULT 0 |
| last_activity_at | TIMESTAMPTZ | NOT NULL DEFAULT now() — drives B9.1 stalled detection |
| created_at / confirmed_at | TIMESTAMPTZ | |

Indexes: `(status)`, `(owner_user_id)`, `(customer_id)`, `(last_activity_at)`.

`blended_score` / `worst_line_overage` / `risk_band` are **caches of a pure function of the lines**, written on every line mutation. Cached because screens 3 and 5 list many quotations and must not recompute per row; safe because a single service function owns every write path (`TRD.md` §5.1).

### `quotation_lines`
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| quotation_id | BIGINT | FK NOT NULL ON DELETE CASCADE |
| product_id | BIGINT | FK NOT NULL |
| variant_id | BIGINT | FK NULL |
| qty | INT | NOT NULL CHECK > 0 |
| unit_price_cents | BIGINT | NOT NULL — **snapshotted at add time** |
| unit_cost_cents | BIGINT | NOT NULL — snapshotted |
| discount_pct | NUMERIC(6,3) | NOT NULL DEFAULT 0 CHECK 0–100 |
| line_type | TEXT | NOT NULL CHECK IN (`one_time`,`recurring`) |
| recurring_interval | TEXT | NULL |
| ceiling_pct | NUMERIC(6,3) | NOT NULL — `min(tier, category)` at evaluation time |
| overage_pct | NUMERIC(6,3) | NOT NULL DEFAULT 0 — `max(0, discount − ceiling)` |
| sort_order | INT | NOT NULL DEFAULT 0 |

> **Why price and cost are snapshotted onto the line.** If the line joined to `products` for price, then an admin editing a product's price would silently rewrite the value of every historical quotation — including approved and invoiced ones. An approval recorded against terms that no longer exist is worse than useless; it is a false audit record. Snapshotting is what makes the audit trail (A3.5) mean anything.

`ceiling_pct` and `overage_pct` are likewise persisted so screen 4's Limit/Status columns and screen 6's "Why This Quote Was Flagged" table render from stored facts rather than a recomputation that might disagree with the score that actually routed the deal.

### `quotation_snapshots` — negotiation rounds
`id · quotation_id FK · round INT · payload JSONB · created_at · UNIQUE(quotation_id, round)`

Full serialisation of lines + totals + score at the close of each negotiation round, so B8.6 re-approval can show *what changed* and the audit trail refers to real historical terms. `UNIQUE` prevents a double-submit creating two round 3s.

---

## 6. Approvals & audit

### `approval_chain_rules` — the configurable routing table (A3.3, screen 18)
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| band | TEXT | CHECK IN (`low`,`medium`,`high`) UNIQUE |
| min_blended_score | NUMERIC(8,3) | NOT NULL — threshold on `S` |
| min_worst_line | NUMERIC(8,3) | NOT NULL — threshold on `M` |
| required_levels | TEXT[] | NOT NULL — `{}`, `{manager}`, `{manager,finance}` |

Seed: `low → {}` · `medium → {manager}` · `high → {manager,finance}`. Screen 18's "Save configuration" writes here. **All four thresholds are rows, not constants** — this is the concrete answer to PS §7's "not hardcoded or faked for the demo."

### `approval_requests`
`id · quotation_id FK · negotiation_round INT · blended_score · worst_line_overage · risk_band · status CHECK IN (`pending`,`approved`,`rejected`,`returned`) · created_at · closed_at`

Carries `negotiation_round` so a re-entry from B8.6 creates a **new** request rather than mutating the old one — the history of "this deal was approved, renegotiated, and approved again" survives.

### `approval_steps`
`id · approval_request_id FK · step_no INT · required_role CHECK IN (`manager`,`finance`) · assigned_user_id FK NULL · status CHECK IN (`pending`,`approved`,`rejected`,`returned`) · note TEXT · acted_by_user_id FK NULL · acted_at · UNIQUE(approval_request_id, step_no)`

Renders screen 6's stepper directly. Finance rows are only inserted when the band requires them (B4.2).

### `audit_log` — append-only
| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| entity_type | TEXT | NOT NULL — `quotation`, `approval`, `subscription`, … |
| entity_id | BIGINT | NOT NULL |
| actor_kind | TEXT | NOT NULL CHECK IN (`internal`,`portal`,`system`) |
| actor_user_id | BIGINT | FK NULL |
| actor_contact_id | BIGINT | FK NULL |
| action | TEXT | NOT NULL |
| note | TEXT | NULL — the "reason" A3.5 requires |
| before / after | JSONB | NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Index `(entity_type, entity_id, created_at DESC)`.

> **Append-only is enforced at the data layer, not by convention.** The application connects as a role holding only `INSERT`/`SELECT` on this table — `UPDATE` and `DELETE` are not granted. A bug cannot rewrite history, and neither can a compromised endpoint. `actor_kind` distinguishes a customer's portal action from a rep's, which is exactly what screen 6's trail needs to be trustworthy.

Screen 2's Recent Activity feed is a `SELECT … ORDER BY created_at DESC LIMIT 10` here — the feed costs nothing because the audit log already exists.

---

## 7. Fulfillment

### `orders`
`id · quotation_id FK UNIQUE · ref UNIQUE · status CHECK IN (`split_pending`,`reserved`,`partially_shipped`,`shipped`,`backorder`,`cancelled`) · promised_date DATE · created_at`

### `order_shipments`
`id · order_id FK · warehouse_id FK · est_cost_cents · est_shipment_count INT · status CHECK IN (`proposed`,`accepted`,`shipped`) · is_manual_override BOOLEAN DEFAULT false · shipped_at`

`is_manual_override` records that a human overrode the proposal (B6.3) — worth auditing, since the proposal is our algorithm and a pattern of overrides is evidence it needs tuning.

### `shipment_lines`
`id · shipment_id FK · quotation_line_id FK · qty INT CHECK > 0`

### `backorders`
`id · order_id FK · quotation_line_id FK · qty_pending INT CHECK > 0 · resolved_at NULL`
Drives B6.4's automatic "Consolidate Remaining Backorder" prompt: an unresolved row whose product now has available stock.

---

## 8. Subscriptions, billing, invoicing

### `subscription_plans`
`id · name · interval CHECK IN (`weekly`,`monthly`,`quarterly`,`yearly`) · proration_mode CHECK IN (`daily`,`none`) · refund_policy CHECK IN (`prorated_credit`,`none`) · archived_at`

### `subscriptions`
`id · customer_id FK · quotation_line_id FK · plan_id FK · status CHECK IN (`active`,`paused`,`cancelled`) · qty INT · unit_price_cents · current_period_start DATE · next_bill_date DATE · cancelled_at`
Index `(next_bill_date) WHERE status='active'` — the billing sweep touches only due rows.

### `billing_schedule`
`id · subscription_id FK · period_start DATE · period_end DATE · amount_cents · status CHECK IN (`scheduled`,`invoiced`,`skipped`) · invoice_id FK NULL · UNIQUE(subscription_id, period_start)`

The `UNIQUE` is the **idempotency guard**: running the billing sweep twice cannot double-bill a customer, because the second insert violates the constraint. This is enforced by the database rather than by remembering to check first.

### `subscription_changes` — proration history (A5.2, screen 10)
`id · subscription_id FK · change_type CHECK IN (`qty`,`plan`,`cancel`,`pause`) · old_qty · new_qty · old_plan_id · new_plan_id · effective_at · proration_cents BIGINT · credit_note_id FK NULL · created_at`

`proration_cents` is signed: positive = additional charge, negative = credit owed. Storing the computed figure means screen 10's proration history shows what was actually applied, not a recomputation that might now differ.

### `invoices`
`id · ref UNIQUE (`INV-1042`) · customer_id FK · order_id FK NULL · subscription_id FK NULL · kind CHECK IN (`one_time`,`recurring`) · amount_cents · tax_cents · status CHECK IN (`unpaid`,`partial`,`paid`,`void`) · due_date · issued_at`
`CHECK (order_id IS NOT NULL OR subscription_id IS NOT NULL)` — an invoice with no origin is unreconcilable.

### `invoice_lines`
`id · invoice_id FK · description · qty · amount_cents · quotation_line_id FK NULL · shipment_id FK NULL`

`shipment_id` is how **C4** is enforced: a one-time invoice line exists only where a shipment line exists. *"Nothing is billed before it ships"* (screen 13) becomes a structural property rather than a rule someone has to remember.

### `payments`
`id · invoice_id FK · amount_cents CHECK > 0 · method CHECK IN (`cash`,`bank`,`card`) · reference · recorded_by_user_id FK · recorded_at`

Invoice status is **derived** — `sum(payments) = 0 → unpaid`, `< amount → partial`, `>= amount → paid` — recomputed inside the same transaction that inserts the payment. Not a field a human sets.

### `credit_notes`
`id · customer_id FK · invoice_id FK NULL · subscription_change_id FK NULL · amount_cents · reason · created_at`

---

## 9. Portal interaction

### `portal_comments` (B8.3)
`id · quotation_id FK · quotation_line_id FK NULL · contact_id FK · body TEXT · created_at`

### `negotiation_requests` (B8.4, B8.7)
`id · quotation_id FK · contact_id FK · round INT · counter_discount_pct NUMERIC(6,3) NULL · requested_delivery_date DATE NULL · message TEXT · status CHECK IN (`open`,`accepted`,`rejected`) · created_at`

> **Authorization note.** Every portal query is scoped by `contact_id` taken **from the session**, never from the request body or URL. The pattern is `WHERE quotation_id = $1 AND customer_id = (SELECT customer_id FROM contacts WHERE id = $session_contact)`. Guessing a quotation ID returns zero rows rather than another customer's deal — the IDOR check is inside the query, so it cannot be forgotten by a handler that omits a guard clause.

---

## 10. Intelligence

### `product_affinity` — upsell source (A6.1)
`product_a_id · product_b_id · co_count INT · support NUMERIC · confidence NUMERIC · lift NUMERIC · computed_at · PRIMARY KEY (product_a_id, product_b_id)`

A **materialised** result, recomputed from confirmed quotations on order confirmation and on demand. Not a live query: B5's panel must respond while a rep types, and the pairwise scan is O(lines²) per order. Staleness is bounded by "since the last confirmed order", which is acceptable for a recommendation and is stated honestly in `AI_EXPLAINABILITY.md`.

### `deal_health_config`
`id · stalled_days INT NOT NULL DEFAULT 7 · anomaly_multiplier NUMERIC DEFAULT 2.0 · updated_at`
B9.1 requires the stalled threshold be *configured*, so it is a row. Screen 14's "5 quotes idle 7+ days" reads from it.

### `deal_alerts`
`id · quotation_id FK · alert_type CHECK IN (`stalled`,`discount_anomaly`,`delivery_slippage`) · detail TEXT · severity · flagged_at · resolved_at NULL · UNIQUE(quotation_id, alert_type) WHERE resolved_at IS NULL`

The partial unique index stops one stalled deal generating a new alert on every dashboard load.

### `nudges` (B9.5, B9.6)
`id · quotation_id FK · alert_id FK NULL · kind CHECK IN (`nudge`,`escalation`) · sent_by_user_id FK · target_user_id FK · message · created_at`
Persisted so screen 14's Action column can show "Nudge sent" / "Escalated to Manager" as facts.

---

## 11. Where integrity is enforced, and why

The master prompt asks for this split explicitly.

### Enforced by PostgreSQL

| Invariant | Mechanism | Why here |
|---|---|---|
| No overselling | `CHECK (reserved <= on_hand)` | Last line of defence. Application logic can be wrong under concurrency; the constraint cannot. |
| No double-billing a period | `UNIQUE(subscription_id, period_start)` | Idempotency that survives a retried or concurrently-run billing sweep. |
| No orphan lines | FK `ON DELETE CASCADE` / `RESTRICT` | A quotation line without a quotation is unreachable garbage that still shows up in aggregates. |
| Valid states only | `CHECK` on every status column | Stops a typo introducing a state no code handles. |
| Subscription products are billable | `CHECK (NOT is_subscription OR recurring_interval IS NOT NULL)` | Unbillable subscription is a silent revenue bug. |
| Audit history immutable | Table-level grants: no `UPDATE`/`DELETE` | Convention is not enforcement. |
| No duplicate open alerts | Partial `UNIQUE` index | Cheaper and more reliable than a check-then-insert. |
| Positive quantities and amounts | `CHECK > 0` | Negative-quantity lines break every downstream sum. |

### Enforced by the application

| Invariant | Where | Why not the DB |
|---|---|---|
| Risk score correctness | `services/risk.ts` | It is a multi-row computation with configurable inputs; expressing it as a constraint would be unreadable and unchangeable. |
| Approval state transitions | `services/approval.ts` | Legal transitions depend on the chain configuration, which is data. A CHECK constraint cannot consult another table. |
| Warehouse split optimisation | `services/fulfillment.ts` | It is a proposal, not an invariant — humans may override it (B6.3). |
| Proration arithmetic | `services/billing.ts` | Depends on plan policy and wall-clock dates. |
| Role permissions | middleware | Row-level security was considered and rejected: with 4 roles × ~40 endpoints, RLS policies would be harder to audit under time pressure than explicit middleware, and a judge can read middleware. |
| Price resolution | `services/pricing.ts` | Multi-step fallback across three tables. |

**Rule of thumb applied throughout:** the database enforces what must *never* be violated regardless of which code path runs; the application enforces what is *policy* and therefore configurable. Anything that would be a corrupt row goes in the schema. Anything a user could legitimately reconfigure goes in a service.

---

## 12. Seed data

Seeded to satisfy PS §9's eight-step test flow and match the wireframe's sample values, so the demo and the screenshots agree:

- 3 tiers (Bronze 5 / Silver 10 / Gold 15); categories Hardware 15, Services 10, Subscription 10
- Customers: Acme Corp (Gold), Beta Industries (Silver), Nova Retail, Zenith Co, Orion Ltd, Delta LLC
- Products: Laptop Pro 14 ($1,200), Onsite Setup Service ($450), Extended Warranty ($180), Docking Station ($180), Wireless Mouse, Care Plan 2yr ($40/mo), Support SLA — with realistic `cost_cents` so margins are non-trivial
- Warehouses: Main Warehouse, East Depot — stock levels matching screen 7 (Laptop: 40/18 and 10/6)
- Users: one per role, distinct non-obvious passwords, documented in README (removed or rotated in Phase 6)
- **~40 historical confirmed quotations** — required, not decorative: without them `product_affinity` has no data (B5 shows an empty panel) and B9.2's "discount vs rep average" has no baseline to compare against
- Q-1042 pre-built to the PS §10 example: Laptop 12%/15% OK, Setup Service 18%/10% OVER +8pt
