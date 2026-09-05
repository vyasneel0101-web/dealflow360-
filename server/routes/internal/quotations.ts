/**
 * Quotation routes.
 *
 * Note what every line mutation returns: the WHOLE recomputed quotation, not
 * the line that changed. Screen 4's live Limit/Status columns, the margin rail
 * and the risk summary all update from one response, and none of them is
 * derived client-side (TRD.md §4).
 */
import { Router } from "express";
import { date, decimal, int, object, oneOf, string } from "../../lib/validate.ts";
import { validate, validateQuery } from "../../middleware/validate.ts";
import { currentUser, requireInternal, requireRole } from "../../middleware/auth.ts";
import * as quotations from "../../services/quotations.ts";
import * as repo from "../../repositories/quotations.ts";
import { asyncRoute, sendData } from "../helpers.ts";
import { notFound } from "../../lib/errors.ts";
import type { Id, QuotationStatus } from "../../../shared/types.ts";

const STATUSES = [
  "draft",
  "pending_approval",
  "returned",
  "approved",
  "negotiation",
  "confirmed",
  "rejected",
] as const;

function pathId(raw: string | undefined): Id {
  const parsed = int({ min: 1 }).parse(raw);
  if (!parsed.ok) throw notFound();
  return parsed.value;
}

export const quotationsRouter: Router = Router();

/** Per-route, for the reason documented in routes/internal/catalogue.ts. */
const internal = [requireInternal];

quotationsRouter.get(
  "/quotations",
  internal,
  validateQuery(
    object({
      status: oneOf(STATUSES),
      owner: int({ min: 1 }),
      customer: int({ min: 1 }),
      q: string({ max: 120 }),
      limit: int({ min: 1, max: 200 }),
      offset: int({ min: 0 }),
    }),
  ),
  asyncRoute(async (req, res) => {
    const filter = req.query as never as {
      status?: QuotationStatus;
      owner?: Id;
      customer?: Id;
      q?: string;
      limit?: number;
      offset?: number;
    };
    const page = { limit: filter.limit ?? 50, offset: filter.offset ?? 0 };
    const { items, total } = await quotations.listQuotations({
      ...(filter.status !== undefined ? { status: filter.status } : {}),
      ...(filter.owner !== undefined ? { owner_user_id: filter.owner } : {}),
      ...(filter.customer !== undefined ? { customer_id: filter.customer } : {}),
      ...(filter.q !== undefined ? { q: filter.q } : {}),
      ...page,
    });
    sendData(res, { items, total, ...page });
  }),
);

quotationsRouter.post(
  "/quotations",
  internal,
  validate(
    object({
      customer_id: int({ min: 1, required: true }),
      price_list_id: int({ min: 1 }),
      requested_delivery_date: date(),
    }),
  ),
  asyncRoute(async (req, res) => {
    sendData(res, await quotations.createQuotation(req.body, currentUser(req)), 201);
  }),
);

quotationsRouter.get(
  "/quotations/:id",
  internal,
  asyncRoute(async (req, res) => {
    sendData(res, await quotations.loadQuotation(pathId(req.params.id)));
  }),
);

quotationsRouter.patch(
  "/quotations/:id",
  internal,
  validate(
    object({
      customer_id: int({ min: 1 }),
      price_list_id: int({ min: 1 }),
      requested_delivery_date: date(),
    }),
  ),
  asyncRoute(async (req, res) => {
    sendData(
      res,
      await quotations.updateQuotation(pathId(req.params.id), req.body, currentUser(req)),
    );
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Lines — each returns the fully recomputed quotation
// ─────────────────────────────────────────────────────────────────────────────

quotationsRouter.post(
  "/quotations/:id/lines",
  internal,
  validate(
    object({
      product_id: int({ min: 1, required: true }),
      variant_id: int({ min: 1 }),
      qty: int({ min: 1, max: 100_000, required: true }),
      // scale 3 matches NUMERIC(6,3) — a discount stored at a precision the
      // user was not shown would route deals on an invisible difference.
      discount_pct: decimal({ min: 0, max: 100, scale: 3, required: true }),
    }),
  ),
  asyncRoute(async (req, res) => {
    sendData(res, await quotations.addLine(pathId(req.params.id), req.body, currentUser(req)), 201);
  }),
);

quotationsRouter.patch(
  "/quotations/:id/lines/:lineId",
  internal,
  validate(
    object({
      qty: int({ min: 1, max: 100_000 }),
      discount_pct: decimal({ min: 0, max: 100, scale: 3 }),
    }),
  ),
  asyncRoute(async (req, res) => {
    sendData(
      res,
      await quotations.updateLine(
        pathId(req.params.id),
        pathId(req.params.lineId),
        req.body,
        currentUser(req),
      ),
    );
  }),
);

quotationsRouter.delete(
  "/quotations/:id/lines/:lineId",
  internal,
  asyncRoute(async (req, res) => {
    sendData(
      res,
      await quotations.removeLine(
        pathId(req.params.id),
        pathId(req.params.lineId),
        currentUser(req),
      ),
    );
  }),
);

/** B3.3 — one discount across every line, so governance still sees it. */
quotationsRouter.post(
  "/quotations/:id/order-discount",
  internal,
  validate(object({ discount_pct: decimal({ min: 0, max: 100, scale: 3, required: true }) })),
  asyncRoute(async (req, res) => {
    sendData(
      res,
      await quotations.applyOrderDiscount(pathId(req.params.id), req.body, currentUser(req)),
    );
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// A3.3 — the routing table, as data
// ─────────────────────────────────────────────────────────────────────────────

quotationsRouter.get(
  "/approval-chain",
  internal,
  asyncRoute(async (_req, res) => {
    sendData(res, await repo.listChainRules());
  }),
);

/**
 * Screen 18's "Save configuration". A PUT of the whole table rather than a
 * PATCH per band: the three bands are one coherent policy, and saving them
 * individually would let a manager leave medium stricter than high.
 */
quotationsRouter.put(
  "/approval-chain",
  // Managers configure discount governance, per the PRD §3 matrix.
  [requireInternal, requireRole("manager", "admin")],
  validate(
    object({
      band: oneOf(["low", "medium", "high"] as const, { required: true }),
      min_blended_score: decimal({ min: 0, max: 100, required: true }),
      min_worst_line: decimal({ min: 0, max: 100, required: true }),
      required_levels: string({ max: 40 }),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { band, min_blended_score, min_worst_line, required_levels } = req.body;
    // Comma-separated on the wire so the validator's primitives cover it
    // without a bespoke array-of-enum rule.
    const levels = (required_levels ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s === "manager" || s === "finance");
    sendData(
      res,
      await repo.upsertChainRule({ band, min_blended_score, min_worst_line, required_levels: levels }),
    );
  }),
);
