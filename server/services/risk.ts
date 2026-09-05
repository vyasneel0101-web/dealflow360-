/**
 * The blended discount risk score (A3.4, TRD.md §5.1, PRD.md §6.1).
 *
 * ─── WHY TWO STATISTICS AND NOT ONE ─────────────────────────────────────────
 *
 * PS §10 sets two requirements that a single number cannot satisfy at once:
 *
 *   1. "the Service line broke its own stricter limit… the whole quotation gets
 *      flagged"  →  one badly-over line must flag the order, however small it is.
 *   2. "None of them look alarming alone, but added together… the rep has
 *      quietly given away a lot of margin"  →  many mild overages must aggregate.
 *
 * Any weighting that lets one small line flag the order makes the aggregate
 * meaningless; any aggregate that dilutes one bad line fails requirement 1. So
 * we compute both and route on either:
 *
 *   ceiling_i = min(tier_ceiling, category_ceiling)
 *   overage_i = max(0, discount_i − ceiling_i)        percentage points
 *   weight_i  = line_list_value_i / order_list_value  value share
 *
 *   S = Σ(overage_i × weight_i)     blended — value-weighted average overage
 *   M = max(overage_i)              worst single line
 *
 * Weighted rather than a plain mean because an unweighted average lets a rep
 * bury a large overage on the order's biggest line under many compliant trivial
 * ones. Wireframe screen 6 confirms the reading: "Worst single line (8pt over)
 * plus overall pattern across the order sets the blended score."
 *
 * ─── WHERE IT RUNS ──────────────────────────────────────────────────────────
 *
 * One function, called by every line mutation, by submit, and by portal
 * confirm. That single fact is the whole implementation of B8.6: a
 * customer-initiated change is governed identically to a rep-initiated one,
 * because it is not a second code path.
 *
 * Pure arithmetic over integers and exact decimals. No I/O, no model, nothing
 * to time out.
 */
import { roundPercent } from "../lib/money.ts";
import type {
  ApprovalChainRule,
  Id,
  RiskBand,
  RiskEvaluation,
  RiskLineBreakdown,
} from "../../shared/types.ts";

/** What the engine needs per line. Deliberately not the full line row — the
 *  score depends on exactly these five facts and nothing else. */
export interface RiskLineInput {
  line_id: Id;
  label: string;
  discount_pct: number;
  /** Tier ceiling for the customer. Null means configuration is missing. */
  tier_ceiling_pct: number | null;
  /** Category ceiling for this line's product. Null means missing. */
  category_ceiling_pct: number | null;
  /** qty × unit_price, BEFORE discount — the weight numerator. */
  list_value_cents: number;
}

const BAND_ORDER: RiskBand[] = ["low", "medium", "high"];

/**
 * The evaluation. `rules` comes from `approval_chain_rules` — rows, not
 * constants, so screen 18 can change routing without a deploy (A3.3).
 */
export function evaluateRisk(
  lines: RiskLineInput[],
  rules: ApprovalChainRule[],
): RiskEvaluation {
  // An empty quotation is not risky, it is empty. S = M = 0, band low.
  if (lines.length === 0) {
    return { blended_score: 0, worst_line_overage: 0, band: "low", required_levels: [], lines: [] };
  }

  // FAIL CLOSED. A missing tier or category ceiling means we cannot say whether
  // a discount is within policy — so we route to the highest band rather than
  // assume it is fine. Under-approving is a margin loss that nobody catches;
  // over-approving is an inconvenience somebody notices immediately.
  const configMissing = lines.some(
    (line) => line.tier_ceiling_pct === null || line.category_ceiling_pct === null,
  );

  const orderListValue = lines.reduce((sum, line) => sum + line.list_value_cents, 0);

  // Computed ONCE per line, at full precision. Both statistics and the
  // per-line breakdown then read the same numbers — computing overage
  // separately for each would let the displayed reason drift from the score
  // that actually routed the deal, which is the one inconsistency screen 6
  // must never show.
  const computed = lines.map((line) => {
    const ceiling = effectiveCeiling(line);
    const overage = Math.max(0, line.discount_pct - ceiling);
    // A zero-value order would divide by zero. An equal share keeps M
    // meaningful (a 100%-discounted line still has an overage) while S stays
    // finite.
    const weight =
      orderListValue === 0 ? 1 / lines.length : line.list_value_cents / orderListValue;
    return { line, ceiling, overage, weight };
  });

  const breakdown: RiskLineBreakdown[] = computed.map(({ line, ceiling, overage, weight }) => ({
    line_id: line.line_id,
    label: line.label,
    discount_pct: roundPercent(line.discount_pct),
    ceiling_pct: roundPercent(ceiling),
    overage_pct: roundPercent(overage),
    value_weight: Math.round(weight * 10_000) / 10_000,
    status: overage > 0 ? "over" : "ok",
  }));

  // Summed at full precision and rounded once. Rounding each term before
  // summing would drift, and the drift changes who approves the deal.
  const blended = roundPercent(
    computed.reduce((sum, { overage, weight }) => sum + overage * weight, 0),
  );

  const worst = roundPercent(Math.max(...computed.map(({ overage }) => overage)));

  const band = configMissing ? "high" : bandFor(blended, worst, rules);

  return {
    blended_score: blended,
    worst_line_overage: worst,
    band,
    required_levels: levelsFor(band, rules),
    lines: breakdown,
    ...(configMissing ? { failed_closed: true } : {}),
  };
}

/**
 * The stricter of the two ceilings applies. A Gold customer's 15% allowance
 * does not license a 15% discount on a Services line capped at 10% — which is
 * exactly the PS §10 example.
 */
function effectiveCeiling(line: RiskLineInput): number {
  const tier = line.tier_ceiling_pct ?? 0;
  const category = line.category_ceiling_pct ?? 0;
  return Math.min(tier, category);
}

/**
 * The highest band whose threshold is met on EITHER statistic. `or`, not `and`:
 * requirement 1 needs one bad line to escalate on its own, regardless of what
 * the aggregate says.
 */
function bandFor(blended: number, worst: number, rules: ApprovalChainRule[]): RiskBand {
  let result: RiskBand = "low";
  for (const band of BAND_ORDER) {
    const rule = rules.find((r) => r.band === band);
    if (rule === undefined) continue;
    if (blended >= rule.min_blended_score || worst >= rule.min_worst_line) {
      result = band;
    }
  }
  return result;
}

function levelsFor(band: RiskBand, rules: ApprovalChainRule[]) {
  // Missing configuration for the band we landed on: demand both levels rather
  // than none, for the same fail-closed reason as above.
  return rules.find((r) => r.band === band)?.required_levels ?? ["manager", "finance"];
}
