# TRD.md — DealFlow360

**Phase 2 deliverable.** Companion docs: `DB_SCHEMA.md` (data), `design.md` (UI), `WIREFRAME_NOTES.md` (PS↔wireframe reconciliation), `PRD.md` (requirements).

---

## 1. Stack

| Layer | Choice | Version | Why this, and not the alternative |
|---|---|---|---|
| Language | TypeScript | 5.x | One language both ends. Shared API types turn "frontend and backend disagree about a shape" into a compile error rather than a 3 AM debugging session — the specific failure that kills hour-10 hackathon builds. Both devs are full-stack, so nobody is locked out of any file. |
| Runtime | Node.js | 20 LTS | Stdlib covers crypto, zlib, test runner, and HTTP. Fewer dependencies to justify. |
| API | Express | 4.x | Not Next.js: it blurs the client/server boundary exactly where we want judges to *see* a clean REST API. Not Nest: decorators and DI we would have to explain and do not need. Express is ~200 lines of setup; everything after that is ours. |
| Database | **PostgreSQL 16** | | Team decision. Real row-level locking (`SELECT … FOR UPDATE`) for concurrency-safe stock, `NUMERIC` for exact percentage arithmetic, partial unique indexes, table-level grants for the append-only audit log, and `JSONB` for negotiation snapshots. See §2.3 for the offline-criterion mitigation. |
| DB access | `pg` driver, raw SQL | 8.x | No ORM. The master prompt asks for demonstrable DB design and an ORM hides precisely that. `DB_SCHEMA.md` is then literally true rather than a description of generated tables. |
| Frontend | React + Vite | 18 / 5 | React because both devs know it — no learning tax tonight. Vite bundles everything locally; nothing loads from a CDN at runtime, satisfying the offline criterion. |
| Styling | Tailwind (build-time) | 3.x | Team decision. Build-time utility layer, not a component kit — we still write every component ourselves, so the master prompt's "no drag-drop UI kits that generate our whole UI" is respected. Compiled to a local stylesheet; no CDN. Buys ~2h across 19 screens. Design tokens are defined by us in `tailwind.config.js` (see `design.md` §2). |
| Real-time | Server-Sent Events | native | Not WebSockets. We need server→client push only (stock changes, approval transitions, new alerts). SSE is native `EventSource`, zero dependencies, plain HTTP, auto-reconnecting. Choosing the simpler sufficient primitive is a better answer than reaching for `ws`. |
| Auth | Ours: Argon2id + opaque DB-backed session tokens | | Not JWT — a JWT cannot be revoked without building the revocation table you were trying to avoid, at which point it is a worse session token. DB sessions make "we can kill a session instantly" true. |
| Validation | **Custom validator, ours** | | Team decision: no Zod. ~150 lines, zero dependencies. See §6. |
| Tests | `node:test` + `node:assert` | stdlib | Zero dependencies for the per-slice tests Phase 3 requires. |
| PDF | `pdfkit` | 0.15 | Writing a PDF writer from scratch is not a good use of tonight. |
| XLSX | **Ours**, via `node:zlib` | stdlib | An `.xlsx` is a ZIP of a few XML parts. ~80 lines using stdlib `zlib`. No dependency, and "we wrote our own xlsx writer" is a better answer than importing one. |

### Dependency budget: 9 runtime packages

`express` · `pg` · `argon2` · `pdfkit` · `react` · `react-dom` · plus dev: `typescript` · `vite` · `tailwindcss`.

Every one falls inside the master prompt's allowed categories (framework, DB driver, vetted crypto, build tooling). Full justification with build-it-ourselves hour estimates goes in `DEPENDENCIES.md`.

**Explicitly rejected:** Zod (team call — a large third-party validation dependency reads as a red flag; ours is 150 lines), any ORM, any UI component kit, any auth provider, any AI/LLM SDK, `ws`, `lodash`, `moment`/`date-fns` (we need three date helpers, not a library).

### 2.3 The Postgres ↔ offline-criterion tension, and how we resolve it

The website asks teams to *"plan for offline or local solutions"*. Postgres is a local service, not a cloud one, so it satisfies the spirit — but it is a service a judge must have running, which SQLite would not have been. Mitigations, all of which are Phase 6 deliverables:

1. `docker compose up -d` starts Postgres 16 with one command, no manual install, no network beyond first image pull.
2. A documented fallback for judges without Docker: point `DATABASE_URL` at any local Postgres; `npm run db:setup` migrates and seeds.
3. `npm run db:reset` returns the database to demo state in one command — also our own rehearsal safety net.
4. Zero runtime network calls. No CDN, no external API, no telemetry. The app runs with the network cable out.

Recorded honestly: SQLite would have been marginally better on this one criterion; Postgres is better on concurrency correctness, which is a criterion we are judged on more heavily and is harder to fake.

---

## 2. System architecture

```
┌──────────────────────────┐        ┌──────────────────────────┐
│   INTERNAL SPA           │        │   PORTAL SPA             │
│   React + Vite           │        │   React + Vite           │
│   19 screens, 2 shells   │        │   3 screens              │
│   /app/*                 │        │   /portal/*              │
└───────────┬──────────────┘        └───────────┬──────────────┘
            │ Bearer <internal session>          │ Bearer <portal session>
            │ + SSE /api/events                  │
            v                                    v
┌─────────────────────────────────────────────────────────────────┐
│  EXPRESS API                                                     │
│                                                                  │
│  ┌────────────────────────┐      ┌───────────────────────────┐  │
│  │ requireInternal()      │      │ requirePortal()           │  │
│  │  → sessions table      │      │  → portal_sessions table  │  │
│  │  → req.user            │      │  → req.contact            │  │
│  └───────────┬────────────┘      └───────────┬───────────────┘  │
│              │ requireRole(...)               │ (scoped queries)│
│              v                                v                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ validate(schema)  — our validator, every mutating route   │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             v                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SERVICES  (all business logic, no SQL in routes)          │   │
│  │  pricing · risk · approval · fulfillment · billing        │   │
│  │  invoicing · upsell · dealhealth · audit                  │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             v                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ REPOSITORIES — parameterised SQL only, never string-built │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────┴───────────────────────────────┐   │
│  │ eventBus → SSE hub  (stock · approvals · alerts)          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              v
                   ┌─────────────────────┐
                   │   PostgreSQL 16     │
                   │  app_rw role:       │
                   │   audit_log = I+S   │
                   │   (no UPDATE/DELETE)│
                   └─────────────────────┘
```

**Two SPAs, not one with a role check.** The portal is a separate Vite entry point, a separate bundle, a separate route tree, served under `/portal`. Internal code is never shipped to a customer's browser. This is the structural reading of PS §7's *"a real, separate, restricted view, not just another internal screen with a different label."*

**Layering rule, enforced in review:** routes do no SQL and no business logic; services do no HTTP and no `req`/`res`; repositories do no business logic. A route handler that reaches for `pool.query` is a bug even if it works.

---

## 3. Auth & session design

### Passwords
**Argon2id**, `argon2` package (libsodium-backed), memory 19 MiB / iterations 2 / parallelism 1 — the OWASP-recommended baseline. Chosen over bcrypt for GPU-attack resistance; chosen over anything hand-written because homemade crypto is the one thing the master prompt names outright.

### Sessions
On login: generate 32 bytes from `crypto.randomBytes`, return it base64url to the client, store **only** `sha256(token)` in the DB. A database dump therefore yields no usable credential. Lookup:

```sql
SELECT * FROM sessions
 WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
```

Internal TTL 12h; portal TTL 2h. Logout sets `revoked_at` — instantaneous, unlike a JWT.

### The two realms
`sessions` and `portal_sessions` are separate tables with separate middleware. `requireInternal` looks only in `sessions`; `requirePortal` looks only in `portal_sessions`. **A portal token presented to an internal endpoint is not "a user with the wrong role" — it is not a user at all.** There is no shared code path where a missing role check could leak, because the identity types are disjoint (`req.user` vs `req.contact`) and TypeScript will not let one stand in for the other.

### Magic links (A1.2)
32 bytes from `crypto.randomBytes` → hash stored in `magic_links`, scoped to one `quotation_id`, TTL 24h, `used_at` set on redemption (single use). Redemption mints a `portal_session`. A leaked link is one document for one day, not an account.

**Delivery:** the link is generated and displayed in-app on the rep's Send action, and written to a `sent-mail/` folder. A demo must never depend on inbox delivery over conference wifi — and the offline criterion forbids relying on an SMTP service anyway.

### Authorization
`requireRole('manager','admin')` on internal routes, per the `PRD.md` §3 matrix. Object-level checks live **inside the SQL**, not in handler guard clauses:

```sql
-- portal: cannot be forgotten, because omitting it returns no rows
WHERE q.id = $1
  AND q.customer_id = (SELECT customer_id FROM contacts WHERE id = $2)
```

**Mass-assignment defence:** the validator whitelists fields per endpoint. `role`, `tier_id`, `status`, `risk_band`, `unit_price_cents` and every approval field are simply not accepted from any request body — they are set by services. An unknown key is a 400, not a silent ignore, so a probe is visible in the logs.

---

## 4. API contract

Base `/api`. JSON in, JSON out. Auth via `Authorization: Bearer <token>`.

**Uniform success:** `{ "data": <payload> }` · **Uniform error:** `{ "error": { "code": "...", "message": "...", "fields": {...} } }`

**Codes:** `200` ok · `201` created · `400` validation (`fields` populated) · `401` no/invalid session · `403` authenticated but not permitted · `404` absent *or not yours* (never distinguished — distinguishing them is an enumeration oracle) · `409` state conflict (illegal transition, insufficient stock) · `422` business-rule rejection · `429` rate-limited · `500` unexpected, generic message only.

### Auth
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | internal signup; role defaults `rep`, **never settable from body** |
| POST | `/auth/login` | — | rate-limited, see §7 |
| POST | `/auth/logout` | internal | revokes session |
| GET | `/auth/me` | internal | current user + role |
| POST | `/portal/auth/magic-link` | internal | rep generates link for a quotation |
| POST | `/portal/auth/redeem` | — | token → portal session |
| POST | `/portal/auth/login` | — | email + password fallback |

### Configuration (admin)
`GET/POST/PATCH /products` · `PATCH /products/:id/archive` · `GET/POST/DELETE /products/:id/variants` · `GET/POST/PATCH /price-lists` · `GET/POST/PATCH /tiers` · `GET/POST/PATCH /categories` · `GET/PUT /approval-chain` · `GET/POST/PATCH /warehouses` · `GET/PATCH /warehouses/:id/stock` · `GET/POST/PATCH /subscription-plans` · `GET/PUT /deal-health-config`

### Quotations
| Method | Path | Notes |
|---|---|---|
| GET | `/quotations` | filters: `status`, `owner`, `customer`, `q`; paginated |
| POST | `/quotations` | |
| GET | `/quotations/:id` | lines + per-line ceiling/overage + totals + margin + risk |
| PATCH | `/quotations/:id` | customer, price list, requested delivery date |
| POST | `/quotations/:id/lines` | **returns the full recomputed quotation** |
| PATCH | `/quotations/:id/lines/:lineId` | qty or discount — same |
| DELETE | `/quotations/:id/lines/:lineId` | same |
| POST | `/quotations/:id/submit` | evaluates risk → routes, or confirms directly if band `low` |
| GET | `/quotations/:id/upsell` | ranked suggestions with margin delta |
| POST | `/quotations/:id/upsell/:productId/dismiss` | |
| GET | `/quotations/:id/audit` | |

> Every line mutation returns **the whole recomputed quotation** — totals, margin, per-line ceiling/overage, blended score, band. The client never derives a governance figure. This is what makes screen 4's live Limit/Status columns correct rather than approximately correct, and it means the same code path runs whether a rep or a customer triggered the change.

### Approvals
`GET /approvals` (band/stage/assignee filters) · `GET /approvals/:id` (risk breakdown + steps + audit) · `POST /approvals/:id/approve|reject|return` (`{ note }`, note required on reject/return)

### Fulfillment
`GET /fulfillment/stock` · `GET /fulfillment/orders` · `GET /orders/:id/split-proposal` · `POST /orders/:id/split/accept` · `POST /orders/:id/split/override` · `POST /orders/:id/shipments/:sid/ship` · `POST /orders/:id/backorders/consolidate`

### Subscriptions & billing
`GET /subscriptions` · `GET /subscriptions/:id` (one-time + recurring lines + schedule + proration history) · `PATCH /subscriptions/:id` (qty/plan → prorate) · `POST /subscriptions/:id/cancel` · `POST /subscriptions/:id/pause`

### Invoices
`GET /invoices` · `GET /invoices/:id` · `POST /invoices/:id/payments` · `GET /invoices/:id/pdf`

### Deal health & reports
`GET /deal-health` · `POST /deal-health/alerts/:id/nudge` · `POST /deal-health/alerts/:id/escalate` · `GET /reports/summary` (period/team/status/category filters) · `GET /reports/export.pdf` · `GET /reports/export.xlsx`

### Portal — separate namespace
| Method | Path | Notes |
|---|---|---|
| GET | `/portal/quotation` | **no id** — derived from session. Nothing to enumerate. |
| POST | `/portal/quotation/comments` | line-level |
| POST | `/portal/quotation/negotiate` | counter discount + requested delivery date |
| POST | `/portal/quotation/confirm` | re-evaluates risk; re-enters approval or proceeds |
| GET | `/portal/messages` | |
| GET/PATCH | `/portal/profile` | |

> `GET /portal/quotation` taking **no identifier** is deliberate. There is no ID for an attacker to change. The resource is a function of the session, so the IDOR class of bug does not exist on this route rather than being defended against on it.

### Events (SSE)
`GET /api/events` (internal) · `GET /api/portal/events` (portal, scoped to one quotation).
Event types: `stock.changed` · `quotation.updated` · `approval.changed` · `alert.raised` · `invoice.paid`. Payloads carry IDs only; the client refetches. That keeps authorization on the fetch, so a pushed event can never itself leak a field the recipient is not allowed to see.

---

## 5. Core algorithms — data flow

### 5.1 Blended discount risk score

**Input** — quotation lines with `discount_pct`; `customer_tiers.max_discount_pct`; `product_categories.max_discount_pct`; `approval_chain_rules`.

```
for each line i:
    ceiling_i = min(tier_ceiling, category_ceiling(line.category))
    overage_i = max(0, discount_i − ceiling_i)          # percentage points
    weight_i  = line_list_value_i / order_list_value    # value share

    S = Σ (overage_i × weight_i)      # blended: value-weighted average overage
    M = max(overage_i)                # worst single line

band = highest rule in approval_chain_rules where S ≥ min_blended_score
                                             OR M ≥ min_worst_line
levels = band.required_levels          # {} | {manager} | {manager,finance}
```

**Output** — `{ S, M, band, levels, perLine:[{ceiling, overage, status}] }`, persisted to `quotations` and each `quotation_line`, and rendered directly by screens 4, 5 and 6.

**Why two statistics.** PS §10 states two requirements a single number cannot meet at once: one badly-over line must flag the order regardless of its size (→ `M`), and many mildly-over lines must accumulate (→ `S`). Weighted rather than a plain mean, because an unweighted average lets a rep bury a large overage on the order's biggest line under many compliant trivial lines. Screen 6 confirms the reading: *"Worst single line (8pt over) plus overall pattern across the order sets the blended score."*

**Where it runs** — `services/risk.ts`, called by every line mutation, by submit, and by portal confirm. **One function, one call site pattern**, so a customer-initiated change is governed identically to a rep-initiated one. That single fact is the whole implementation of B8.6.

**Failure behaviour** — pure arithmetic over integers and exact `NUMERIC`; no I/O, no model, nothing to time out. Degenerate inputs are handled explicitly: an empty quotation gives `S=M=0`, band `low`; a zero-value order avoids division by zero by short-circuiting to `S=0`. If category or tier config is missing, the service **fails closed** — routes to the highest band rather than approving. Under-approving is a margin loss; over-approving is an inconvenience.

### 5.2 Warehouse split (A4.3, B6)

Greedy under a shipping-cost objective, inside one transaction:

```sql
BEGIN;
SELECT on_hand, reserved FROM stock
 WHERE product_id = ANY($1) FOR UPDATE;   -- row locks, ordered by (warehouse_id, product_id)
```
Order lines by quantity descending; for each, prefer the warehouse that can satisfy it **whole** at lowest `shipping_cost_weight`; if none can, split across the fewest warehouses; any remainder becomes a `backorders` row. Then `UPDATE stock SET reserved = reserved + n`, and `COMMIT`.

Locks are acquired in a **deterministic order** (`warehouse_id, product_id`) so two concurrent confirmations cannot deadlock. The `CHECK (reserved <= on_hand)` constraint is the backstop if the logic is nonetheless wrong.

Greedy, not optimal — this is bin-packing and optimality is not worth hours tonight. Stated plainly as a limitation, with the objective (minimise shipment count, then cost) written down so the behaviour is predictable.

### 5.3 Upsell ranking (A6, B5)

```
lift(A→B) = P(B | A) / P(B)     over historical confirmed quotations
score      = lift × promo_boost
filter     : margin_delta ≥ min_margin_threshold
```

Lift rather than raw co-occurrence, because raw counts merely surface the best-selling product to everyone — the definition of a useless recommendation. Materialised into `product_affinity` on order confirmation.

**Fallback (the failure mode that matters):** a fresh install has no order history, so lift is undefined. Fall back to same-category affinity plus the promoted flag, and label the panel as such in the UI. A panel that silently shows nothing looks broken; one that says why it is thin looks deliberate.

Full treatment, including the hardest anticipated judge question, goes in `AI_EXPLAINABILITY.md` during Phase 3.

### 5.4 Deal health (B9)

Computed on read, from `deal_health_config`:
- **Stalled** — `now() - last_activity_at > stalled_days`
- **Discount anomaly** — order discount > `anomaly_multiplier` × that rep's trailing mean, requiring ≥ 5 prior quotations for a baseline. Below that the rep is marked *insufficient history* rather than flagged — a new rep's first deal must not be an anomaly by construction.
- **Slippage** — `promised_date < now()` and order not shipped.

---

## 6. Input validation — ours

Team decision: no Zod. `src/lib/validate.ts`, ~150 lines, zero dependencies.

```ts
const CreateLine = object({
  product_id:   int({ min: 1, required: true }),
  variant_id:   int({ min: 1 }),
  qty:          int({ min: 1, max: 100_000, required: true }),
  discount_pct: decimal({ min: 0, max: 100, scale: 3, required: true }),
});
router.post('/:id/lines', requireInternal, requireRole('rep','manager','admin'),
            validate(CreateLine), handler);
```

Primitives: `string({min,max,pattern,trim})` · `int({min,max})` · `decimal({min,max,scale})` · `bool()` · `enum([...])` · `date()` · `email()` · `array(of,{min,max})` · `object({...})`.

Four properties that matter more than the API surface:

1. **Whitelist, not blacklist.** Unknown keys are rejected with 400. Mass assignment is impossible by construction — `role` is not "filtered out", it is never accepted.
2. **Coerce then validate.** Query strings arrive as text; `int()` parses and range-checks in one place, so no handler ever calls `parseInt` and forgets `NaN`.
3. **Collect all errors.** Returns `{fields: {qty: "must be at least 1", discount_pct: "must be at most 100"}}`, so the UI can mark every bad field at once instead of one per round trip.
4. **Bounded by default.** Every string has a max length and every array a max size, so oversized-payload denial of service is closed at the validator rather than at the far end.

Applied to **every** mutating route without exception — a route without `validate()` fails review.

---

## 7. Cross-cutting

**Rate limiting** — in-memory sliding window, no dependency. `/auth/login` and `/portal/auth/redeem` limited per IP and per identity; `429` with `Retry-After`. Blunt, but it closes credential stuffing, which is what Phase 5 checks for.

**Error handling** — one Express error middleware. Known `AppError`s carry a code and status. Everything else logs the stack server-side and returns a generic 500. **No stack trace ever crosses the wire.** `NODE_ENV=production` in the demo build.

**Transactions** — `withTransaction(fn)` helper. Mandatory for: stock reservation, order confirmation, payment recording, subscription change with proration, and any multi-table write. Audit entries are written inside the same transaction as the change they describe, so a rollback cannot leave a log entry describing something that never happened.

**Money** — `BIGINT` cents everywhere, never `float`. Percentages exact via `NUMERIC`. Rounding is half-up at the final line total only, once, in `services/pricing.ts`.

**Logging** — structured JSON to stdout. Passwords, tokens and hashes are never logged; the logger has an explicit redaction key list.

---

## 8. Repository & Git protocol

The website grades this: *"Use version control (Git) properly; one member managing the repo is not enough."* Treated as a requirement.

- `main` protected by convention — no direct pushes; work goes through `slice/<name>` branches.
- **Both developers commit.** Branches are assigned per slice from the Phase 3 plan; each dev merges their own work. A build where one name owns 95% of commits fails this criterion regardless of code quality.
- Conventional commits: `feat(risk): blended score with worst-line override`.
- `.env` never committed; `.env.example` is. `.gitignore` covers `node_modules`, `dist`, `.env`, `sent-mail/`.
- Merge at each slice boundary, not at the end. Two people and one merge at 04:00 is how integration nights are lost.

---

## 9. Repository layout

```
D:\Dealflow
├── docs/                 DECISION PRD TRD DB_SCHEMA design WIREFRAME_NOTES
│                         DEPENDENCIES AI_EXPLAINABILITY PHASE_LOG
│                         TEST_LOG SECURITY_REVIEW
├── db/
│   ├── migrations/       001_identity.sql … 010_dealhealth.sql
│   └── seed/             seed.ts
├── server/
│   ├── index.ts          express bootstrap
│   ├── lib/              validate.ts  errors.ts  crypto.ts  sse.ts  money.ts
│   ├── middleware/       requireInternal requirePortal requireRole rateLimit
│   ├── repositories/     parameterised SQL only
│   ├── services/         pricing risk approval fulfillment billing
│   │                     invoicing upsell dealhealth audit export
│   └── routes/           internal/*  portal/*
├── shared/               types.ts — the API contract, imported by both ends
├── web/                  internal SPA (Vite entry 1)
├── portal/               portal SPA (Vite entry 2)
└── tests/                node:test per slice
```

`shared/types.ts` is the point of the whole stack choice: one definition of every request and response shape, imported by server and both clients. A contract drift becomes a type error at build time rather than a bug found during the demo.

---

## 10. Known technical limitations

Recorded now, for `SECURITY_REVIEW.md` and the stage round. Honest limitations stated up front read as judgment; discovered by a judge, they read as gaps.

| # | Limitation | Reasoning |
|---|---|---|
| 1 | Warehouse split is greedy, not optimal | Bin-packing; optimality is not worth the hours. Objective is documented and behaviour is predictable. |
| 2 | Product variants are a flat attribute list, not a combination matrix | Matches the wireframe's UI exactly; a full matrix costs hours and renders a screen nobody drew. |
| 3 | `product_affinity` is materialised, so suggestions lag the newest order | Bounded staleness, acceptable for a recommendation, disclosed in-product. |
| 4 | Rate limiting is in-memory | Single-process demo. A restart clears counters; a multi-instance deployment would need shared state. |
| 5 | Magic links surface in-app and on disk rather than by email | Deliberate: the offline criterion forbids depending on SMTP, and a demo must not depend on inbox delivery. |
| 6 | Multi-currency is per-price-list, not application-wide | The PS classifies application-wide multi-currency as a bonus. `PRD.md` §5.D. |
| 7 | Postgres requires a running service, unlike SQLite | Mitigated by Docker Compose + one-command setup (§2.3). Traded for genuine row-level locking. |
