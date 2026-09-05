# design.md — DealFlow360 UI/UX

Derived from the Excalidraw wireframe (see `WIREFRAME_NOTES.md`). The wireframe is authoritative for layout and navigation; this file records the system that makes 22 screens buildable by two people in one night without drifting apart.

---

## 1. The governing decision

The wireframe's own Navigation Key states that **each module has one list screen and one detail screen, opened by clicking a row.** Five modules follow that pattern identically: Quotations, Approvals, Fulfillment, Subscriptions, Invoices.

So we build **two shells and configure them**, rather than ten screens.

| | Screens using it | Structure |
|---|---|---|
| `<ListScreen>` | 3, 5, 7, 9, 12, 16 | KPI chip row → filter bar → data table → row click |
| `<DetailScreen>` | 4, 6, 8, 10, 13, 17 | Title + status → optional stepper → section stack → sticky action bar |
| Bespoke | 1, 2, 11, 14, 15, 18 | Login, Dashboard, Portal, Deal Health, Reports, Config |

This is the schedule. Ten of the sixteen internal screens become configuration objects — column definitions, KPI queries, section lists — not new components. It is also the answer to consistency: screens cannot drift apart when they are the same component.

**Rule for both devs: no new layout primitive without agreeing it.** If a screen seems to need a new shell, it probably needs a new *section* inside `DetailScreen`. This is the single most important agreement of the night — two people inventing layouts in parallel is exactly how the last four hours get spent on reconciliation instead of features.

---

## 2. Design tokens

Defined by us in `tailwind.config.js`. Tailwind is the delivery mechanism; the system is ours.

### Spacing — 4px base, six steps only
`1 (4px) · 2 (8px) · 3 (12px) · 4 (16px) · 6 (24px) · 8 (32px)`

Six steps, not Tailwind's default thirty-two. A constrained scale is what makes independently-built screens line up. Page gutter `6`, card padding `4`, related elements `2`, section separation `8`.

### Colour

Neutrals carry the UI; colour is reserved for **state**, never decoration. In a governance product, a coloured thing must mean something — if colour is decorative, users stop reading it, and the OVER badge on screen 4 stops working.

| Token | Value | Used for |
|---|---|---|
| `bg` | `#F7F8FA` | app background |
| `surface` | `#FFFFFF` | cards, tables |
| `border` | `#E4E7EC` | dividers, table rules |
| `text` | `#101828` | primary |
| `text-muted` | `#667085` | labels, metadata |
| `brand` | `#2563EB` | primary actions, active nav |
| `ok` | `#12805C` | OK, Approved, Paid, Active |
| `warn` | `#B54708` | MEDIUM risk, Pending, Backorder |
| `danger` | `#B42318` | HIGH risk, OVER, Rejected, Unpaid |
| `info` | `#175CD3` | Draft, Under Negotiation |

**Risk bands map to fixed colours everywhere they appear** — LOW `ok`, MEDIUM `warn`, HIGH `danger` — on screens 5, 6 and 14 alike. A judge scanning the approvals list learns the encoding once.

**Accessibility:** all state colours are used as text or bordered badges on `surface`, never as colour alone — the badge carries a word (`OVER (+8pt)`), not just a hue. Every pairing clears 4.5:1.

### Type — four sizes
`xs 12px` metadata · `sm 14px` body and table cells · `base 16px` section headings · `xl 20px` page titles. Weights: 400, 500, 600. Tabular figures (`font-variant-numeric: tabular-nums`) on every money and percentage column, so digits align down a column — a small thing that makes a financial table look built by someone who has made one before.

### Radius & elevation
`4px` inputs/badges, `8px` cards. One shadow, on overlays only. Flat surfaces separated by `border`, not by stacked shadows.

---

## 3. Navigation

Nine-item top bar (wireframe): **Dashboard · Quotations · Approvals · Fulfillment · Subscriptions · Invoices · Deal Health · Reports · Product**. Active tab carries a `brand` underline and `text` weight 600; inactive are `text-muted` — matching the wireframe's "white highlighted tab shows which module you are in."

Utility cluster, right-aligned, visually secondary: **Reload Data** (B1.2) · **Go to Back-end** (B1.3) · **Close Workspace** (B1.4) · user menu. These are PS requirements but not module navigation, so they get the right side and lighter weight.

Breadcrumb on every detail screen: `Quotations / Q-1042`. With ten screens deep in a nested flow, the back path must always be visible.

**The portal has its own shell** — three items, **My Quotation · Messages · Profile**, different header treatment, no internal nav present in the bundle at all. A customer must never see the shape of the internal application.

---

## 4. Component inventory

Small and fixed. Anything not on this list needs a conversation first.

`Badge` (state colour + label) · `KpiChip` (label, value, sublabel) · `DataTable` (columns, rows, onRowClick, empty state) · `FilterBar` · `Stepper` (screens 6, 13) · `SectionCard` (title + body) · `ActionBar` (sticky footer) · `Field` (label + input + error + hint) · `Money` · `Percent` · `RiskBadge` · `EmptyState` · `Toast`.

`Field`, `Money` and `Percent` exist so formatting and error display cannot diverge across 22 screens. `Money` renders from integer cents — the UI never sees a float, matching `DB_SCHEMA.md` §0.

---

## 5. States — designed, not defaulted

The master prompt calls these out, and they are the fastest way to look either senior or unfinished.

**Loading** — skeleton rows in tables (never a spinner over a whole page); inline spinners on buttons with the button disabled. Line edits on screen 4 update **optimistically** for quantity, but the margin and risk figures show a brief pending state until the server responds, because those are governance numbers and must never display a client-side guess.

**Empty** — every list has a written empty state with a cause and an action. Not "No data."
- Quotations: *"No quotations yet. Create one to get started."* + `+ New Quotation`
- Approvals: *"Nothing waiting. Quotations only appear here when a discount exceeds its limit."* — teaches the mechanism
- Upsell panel, cold start: *"No purchase history yet — showing category matches and promoted items."* (TRD §5.3 fallback, surfaced honestly)
- Deal Health, clear: *"No deals need attention."* — positive, not empty

**Error** — field-level messages under the field, from the validator's `fields` map, all at once. Request-level failures raise a toast with a plain-language cause and a Retry. Never a raw code, never `undefined`, never a stack.

**Disabled** — buttons disabled with a reason on hover: Submit for Approval is disabled with *"Add at least one line"* rather than silently failing.

---

## 6. Screen-specific decisions

**Screen 4 (Quotation builder)** — the deal screen, and where a judge looks longest. The line table carries `Discount · Limit · Status` per the wireframe, with `OK` in `ok` and `OVER (+8pt)` in `danger`. Status updates **as the discount is typed** (debounced 300ms), per the wireframe note. The margin indicator sits in a persistent summary rail with the order total and the current risk band, so the consequence of a discount is visible in the same glance as the discount itself. The upsell panel is a right rail, not a modal — it must be visible *while* building, per PS B5.

**Screen 6 (Approval detail)** — leads with the **"Why This Quote Was Flagged"** table before the action bar. A reviewer sees the per-line reasoning before the Approve button. The stepper shows Submitted → Sales Manager → Finance → Confirmed, with Finance rendered only when required. Reject and Return require a note — the field is the reason captured in `audit_log`.

**Screen 3 (Quotations)** — stage-grouped cards by default (Draft / Pending Approval / Approved / Negotiation / Confirmed) with **Switch to Table View**. This is how the PS's Kanban pipeline and the wireframe's list reconcile into one screen.

**Screen 11 (Portal)** — deliberately calmer than the internal UI: more whitespace, fewer controls, no jargon. "Blended risk band" never appears; the customer sees status and their own requests. Counter Discount % and Requested Delivery Date sit together above `Submit Request`, with `Confirm Quotation` visually primary. After confirming into re-approval, the status becomes *"Sent back for internal approval"* — the customer is told what happened rather than left on a spinner.

**Screen 14 (Deal Health)** — three KPI chips over one alert table. Every row is clickable through to its quotation (B9.4), with `Nudge Rep` and `Escalate` inline. The Action column shows the outcome (`Nudge sent`) so the dashboard is a workspace rather than a report.

---

## 7. Responsiveness

Desktop-first — this is an internal B2B tool and the demo is on a laptop. But "responsive and clean UI" is an explicit website criterion, so:

- ≥1280px: full layout, side rails visible
- 768–1279px: upsell and summary rails collapse below the line table; nav condenses to icons + labels
- <768px: single column; tables switch to stacked label/value cards rather than scrolling horizontally; nav becomes a drawer

**The portal is mobile-first** — it is the one screen a real customer would plausibly open on a phone, and it is the smallest surface to make work well.

---

## 8. What should read as senior-built

Deliberate, and worth naming for the stage round:

1. **Constrained scales.** Six spacing steps, four type sizes, one shadow. Restraint reads as a system; variety reads as accident.
2. **Colour means state.** Nothing is coloured for decoration, so the risk badges retain their signal value.
3. **Tabular figures in money columns.** Digits align. Almost nobody does this; it is instantly legible to anyone who has built a finance UI.
4. **Empty states that teach.** The Approvals empty state explains the routing rule — the product teaching its own mechanism.
5. **Governance figures never guessed client-side.** The margin shows pending rather than a stale number. Correctness visible in the interaction design.
6. **Disabled buttons say why.** No dead controls.
7. **The portal is visibly a different product.** Different shell, calmer density, no internal vocabulary — the strongest visual evidence for the PS §7 requirement that it be genuinely separate.
