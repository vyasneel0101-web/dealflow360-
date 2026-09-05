# WIREFRAME_NOTES.md — reconciling the Excalidraw wireframe with the PS text

Source: `DealFlow360 - End to End Product Flow 24 hours oxp.excalidraw` (1318 elements, 19 frames).
The wireframe is **authoritative for UI layout and navigation**; the PS text remains authoritative for business rules. Where they differ, this file records the reconciliation.

---

## 1. Screen inventory (19 frames)

| # | Screen | Kind | PS module |
|---|---|---|---|
| 1 | Login / Signup | special | A1 |
| 2 | Sales Dashboard / Home | special | — (new) |
| 3 | Quotations List | list | B2 |
| 4 | Quotation Detail (builder) | detail | B3, B5 |
| 5 | Approvals List | list | B4 |
| 6 | Approval Detail | detail | B4 |
| 7 | Fulfillment & Stock List | list | B6, A4 |
| 8 | Fulfillment Detail (split) | detail | B6 |
| 9 | Subscriptions List | list | B7 |
| 10 | Billing Detail | detail | B7 |
| 11 | Customer Portal | special | B8 |
| 12 | Invoices List | list | C1 |
| 13 | Invoice Detail | detail | C2 |
| 14 | Deal Health Dashboard | special | B9 |
| 15 | Admin Reporting *(marked "Optional")* | special | A7 |
| 16 | Product Dashboard | list | A2 |
| 17 | Product Details + Pricelists | detail | A2 |
| 18 | Discount Tiers & Approval Chain Setup | special | A3 |
| 19 | *(duplicate of 17)* | — | — |

**Note:** frames 16 and 17 contain stray JavaScript test snippets (`getCachedStyleProperty`, `insertTestHtml`, …). These are accidental paste artifacts in the source file and carry no meaning. Ignored.

---

## 2. The governing pattern

The wireframe's unframed "Navigation Key" states:

> *"The white highlighted tab shows which module you are in. Each module has one list screen (all records) and one detail screen (one record, opened by clicking a row)."*
> *"Each entity (Quotations, Approvals, Fulfillment, Subscriptions, Invoices) has its own tab, its own list screen, and a detail screen you open by clicking a row."*

**Consequence for the build:** five of the nine modules are the *same two screens* parameterised five ways. We build one `ListScreen` shell (KPI chip row → filter bar → table → row click) and one `DetailScreen` shell (title → status/stepper → section stack → action bar), then configure them. Only screens 1, 2, 11, 14, 15, 18 are bespoke.

This is the single biggest schedule finding of Phase 2 and is why full PS coverage is achievable in the remaining window.

---

## 3. Navigation — wireframe overrides PS

PS §B1 says the top nav contains **Quotations** and **Pipeline**, with actions *Reload Data*, *Go to Back-end*, *Close Workspace*.

The wireframe shows a **nine-item nav**: Dashboard · Quotations · Approvals · Fulfillment · Subscriptions · Invoices · Deal Health · Reports · Product.

**Reconciliation:** adopt the wireframe's nine-item nav. It is a superset — every PS destination is reachable. The three PS workspace actions (B1.2–B1.4) are retained as a utility cluster in the top bar rather than as primary nav, since the wireframe gives primary nav to modules.

**Where did "Pipeline" go?** Screen 3 shows quotations as cards grouped by stage (Draft / Pending Approval / Approved / Negotiation / Confirmed) with a **"Switch to Table View"** button. So the Kanban pipeline *is* the default rendering of the Quotations list, and the table is the alternate. PS B1.1 and B2.1 are both satisfied by screen 3 with a view toggle — not by a separate route.

---

## 4. Rules the wireframe pins down that the PS left open

### 4.1 Risk bands and routing (screens 5, 6, 18)

Screen 18 gives the routing table explicitly:

| Discount range | Approval required |
|---|---|
| Within tier/category limit | **No approval needed** |
| Over limit, blended risk **medium** | **Sales Manager** |
| Over limit, blended risk **high** | **Sales Manager → Finance** |

Screen 5 shows the band as a column with values **LOW / MEDIUM / HIGH**, plus stage `Auto-Approved` for LOW. This confirms the three-band model in `PRD.md` §6.1 and fixes the vocabulary. Bands are derived from `S` (blended) and `M` (worst line); thresholds stay configurable per A3.3.

Screen 6 states the rule in words: *"Worst single line (8pt over) plus overall pattern across the order sets the blended score. One bad line is enough to require approval."* — direct confirmation that **two statistics** are required, exactly as specified in `PRD.md` §6.1.

### 4.2 Live discount checking (screen 4)

> *"Discount is checked against each line's own limit live, as soon as it is entered, not only at submit time."*

The quotation line table carries **Discount / Limit / Status** columns, with status values `OK` and `OVER (+8pt)`. Per-line ceiling and overage must therefore be returned by the API on every line mutation, not computed only at submit. Reinforces the PRD decision to compute margin and risk server-side.

### 4.3 Approval stepper (screen 6)

Fixed stages: **Submitted → Sales Manager → Finance → Confirmed**, with Finance rendered only when required. Audit trail is a table of `User · Action · Date · Note` — matching A3.5. Sample rows show `Submitted / Returned / Resubmitted`, confirming "return for revision" is a real state, not a rejection.

### 4.4 Invoice lifecycle — **a requirement the PS text does not state**

Screen 13 shows a stepper **Order Confirmed → Shipped → Invoiced → Paid** and the note:

> *"Partial invoicing stays reconciled with partial delivery, nothing is billed before it ships."*

This is a genuine new business rule: **invoicing is gated on shipment**, and a partially-shipped order produces a partial invoice. It affects the fulfillment↔invoice boundary and is not derivable from the PS text alone. Added as requirement **C4**.

### 4.5 Product model detail (screens 16, 17)

- `Subscription: Yes/No` — when Yes, a `Recurring` field (Monthly/Yearly/Weekly) becomes visible. So subscription-ness is a **product attribute**, not only an order-line attribute.
- `Quantity on hand` is an integer field on the product.
- Variants are a flat table of **Attribute · Values · Extra price** (Color → "Blue, Black" → +$30; RAM → "4GB, 8GB"; Manufacturer → "Dell, HP" → +$10/+$30). We model this shape literally rather than as a full variant-combination matrix — it is what the UI shows and it is far cheaper.
- Price lists are **Tier · Currency · Price Rule**, with rules expressed as formulas: *"Price, no adjustment"*, *"Price minus 10 percent base"*. So a price list rule is a small computation, not just a stored number.
- Catalogue stats: *"3 tiers, 2 Currencies"*, *"340 SKUs"*, *"128 active, 6 archived"* → **archive, not delete**, is expected on products.

### 4.6 Customer portal (screen 11)

- Portal has its **own three-item nav**: My Quotation · Messages · Profile — reinforcing that the portal is a separate application shell, not an internal screen with a filter (PS §7).
- Line-level comments are free text against a named line ("Can this be 15% off instead of 10%?").
- Alongside **Counter Discount %** there is a **Requested Delivery Date** field — new, and it feeds delivery-slippage detection (B9.3).

### 4.7 Deal health (screen 14)

Three KPI chips — Stalled Deals / Discount Anomalies / Delivery Slippage — over an alert table of `Deal · Issue · Flagged · Action`. Sample: *"Delta LLC — Discount 22% vs avg 8%"* confirms the anomaly comparison is against **that rep's own historical average**. Actions **Escalate** and **Nudge Rep** are buttons, and the Action column records outcomes (`Nudge sent`, `Escalated to Manager`) — so nudges are persisted records, not fire-and-forget.

### 4.8 Screen 2 — Sales Dashboard is new

The PS never describes a home screen. The wireframe makes it the hub: three KPI cards (Pending Approvals / Open Quotations / At-Risk Deals), a `+ New Quotation` primary action, `View Approvals`, and a **Recent Activity** feed. The activity feed is a natural read of the audit log, so it costs almost nothing given A3.5 already exists.

---

## 5. New requirements added from the wireframe

| ID | Requirement | Source |
|---|---|---|
| **C4** | Invoicing gated on shipment; partial delivery yields partial invoice, reconciled | Screen 13 |
| **B10.1** | Sales Dashboard home: 3 KPI cards, primary actions, recent-activity feed from audit log | Screen 2 |
| **B10.2** | Quotations list renders as stage-grouped cards by default with a Switch to Table View toggle | Screen 3 |
| **B8.7** | Portal `Requested Delivery Date` field, feeding delivery-slippage detection | Screen 11 |
| **B8.8** | Portal has its own nav shell: My Quotation · Messages · Profile | Screen 11 |
| **A2.4** | Products support archive (not delete); catalogue reports active vs archived counts | Screen 16 |
| **A2.5** | Price-list rules are formulas (`no adjustment`, `base minus N percent`), not fixed numbers only | Screen 17 |
| **A2.6** | `Subscription: Yes/No` on the product; reveals recurring interval when Yes | Screen 17 |
| **B9.6** | Nudges and escalations persist as records and display in the alert table's Action column | Screen 14 |

All are **Include** — consistent with the §2 scope directive in `PRD.md`.

---

## 6. Note on multi-currency

Screen 16 reports *"3 tiers, 2 Currencies"* and screen 17 shows a price-list row with currency `USD/EUR`. The wireframe therefore assumes **currency is present in the price-list model** — which is already in scope as A2.3 / A2.5.

This does not promote the BONUS tier (D1: application-wide multi-currency display, conversion and reporting). It does confirm that the price-list table carries a currency column and that the catalogue can report on it. The boundary stated in `PRD.md` §5.D stands.
