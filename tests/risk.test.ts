/**
 * The blended risk score (A3.4). This is the demo, so it is the most heavily
 * tested arithmetic in the build.
 *
 * The suite is organised around the TWO requirements PS §10 sets, because the
 * whole design case for two statistics rests on neither being satisfiable
 * alone. If a future change collapses S and M into one number, the tests named
 * "requirement 1" and "requirement 2" are the ones that must fail.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk, type RiskLineInput } from "../server/services/risk.ts";
import type { ApprovalChainRule } from "../shared/types.ts";

/** The rows migration 005 seeds into `approval_chain_rules`. */
const RULES: ApprovalChainRule[] = [
  { band: "low", min_blended_score: 0, min_worst_line: 0, required_levels: [] },
  { band: "medium", min_blended_score: 2, min_worst_line: 5, required_levels: ["manager"] },
  {
    band: "high",
    min_blended_score: 5,
    min_worst_line: 10,
    required_levels: ["manager", "finance"],
  },
];

function line(over: Partial<RiskLineInput> & { line_id: number }): RiskLineInput {
  return {
    label: `Line ${over.line_id}`,
    discount_pct: 0,
    tier_ceiling_pct: 15,
    category_ceiling_pct: 15,
    list_value_cents: 100_000,
    ...over,
  };
}

describe("PS §10 worked example", () => {
  /**
   * Q-1042 as DB_SCHEMA.md §12 specifies it, and as the seeded demo builds it:
   * a Gold customer (tier ceiling 15).
   *
   *   Laptop Pro 14   3 × $1,200 = $3,600 list, 12% discount, Hardware ceiling 15
   *   Setup Service   1 ×   $450 =   $450 list, 18% discount, Services ceiling 10
   *
   * The laptop is inside its limit. The service line is 8 points over its own
   * stricter one — which is the number wireframe screen 6 prints in words.
   */
  const q1042: RiskLineInput[] = [
    line({
      line_id: 1,
      label: "Laptop Pro 14 (Hardware)",
      discount_pct: 12,
      tier_ceiling_pct: 15,
      category_ceiling_pct: 15,
      list_value_cents: 360_000,
    }),
    line({
      line_id: 2,
      label: "Onsite Setup Service (Services)",
      discount_pct: 18,
      tier_ceiling_pct: 15,
      category_ceiling_pct: 10,
      list_value_cents: 45_000,
    }),
  ];

  test("the stricter of the two ceilings applies per line", () => {
    const result = evaluateRisk(q1042, RULES);
    // Gold's 15% does not license 15% on a Services line capped at 10%.
    assert.equal(result.lines[0]?.ceiling_pct, 15);
    assert.equal(result.lines[1]?.ceiling_pct, 10);
  });

  test("the service line reads OVER by exactly 8 points", () => {
    const result = evaluateRisk(q1042, RULES);
    assert.equal(result.lines[0]?.status, "ok");
    assert.equal(result.lines[1]?.status, "over");
    assert.equal(result.lines[1]?.overage_pct, 8);
    // Screen 6: "Worst single line (8pt over)".
    assert.equal(result.worst_line_overage, 8);
  });

  test("the blended score is value-weighted, so the small line dilutes", () => {
    const result = evaluateRisk(q1042, RULES);
    // Order list value 405,000. The service line is 45,000 of it = 1/9.
    // S = 0 × (360/405) + 8 × (45/405) = 8/9 = 0.889.
    assert.equal(result.blended_score, 0.889);
  });

  test("one bad line flags the whole quotation anyway", () => {
    const result = evaluateRisk(q1042, RULES);
    // S is 0.889 — well under the medium threshold of 2. If the system routed
    // on the blended score alone this deal would sail through, which is
    // precisely the failure PS §10 describes. M = 8 clears min_worst_line 5.
    assert.equal(result.band, "medium");
    assert.deepEqual(result.required_levels, ["manager"]);
  });
});

describe("requirement 1 — one badly-over line must flag the order", () => {
  test("a tiny line with a huge overage still escalates", () => {
    // $10 of a $10,000 order, 40 points over. Its value weight is 0.001, so its
    // contribution to S is negligible — M is the only thing that catches it.
    const result = evaluateRisk(
      [
        line({ line_id: 1, discount_pct: 0, list_value_cents: 999_000 }),
        line({ line_id: 2, discount_pct: 55, list_value_cents: 1_000 }),
      ],
      RULES,
    );
    assert.ok(result.blended_score < 2, `S was ${result.blended_score}`);
    assert.equal(result.worst_line_overage, 40);
    assert.equal(result.band, "high");
    assert.deepEqual(result.required_levels, ["manager", "finance"]);
  });
});

describe("requirement 2 — many mild overages must accumulate", () => {
  test("six lines each barely over aggregate into an escalation", () => {
    // Every line is 6 points over — under min_worst_line for high (10), so M
    // alone would only reach medium. S = 6 clears the high threshold of 5.
    const lines = Array.from({ length: 6 }, (_, i) =>
      line({ line_id: i + 1, discount_pct: 21, list_value_cents: 100_000 }),
    );
    const result = evaluateRisk(lines, RULES);
    assert.equal(result.worst_line_overage, 6);
    assert.equal(result.blended_score, 6);
    assert.equal(result.band, "high");
  });

  test("weighting stops a large overage hiding behind trivial compliant lines", () => {
    // The argument for weighted over unweighted mean. One 20-point overage on
    // the line carrying 90% of the order's value, plus nine compliant scraps.
    const lines: RiskLineInput[] = [
      line({ line_id: 1, discount_pct: 35, list_value_cents: 900_000 }),
      ...Array.from({ length: 9 }, (_, i) =>
        line({ line_id: i + 2, discount_pct: 0, list_value_cents: 11_111 }),
      ),
    ];
    const result = evaluateRisk(lines, RULES);
    // Unweighted, the mean overage would be 20/10 = 2 — merely medium.
    // Weighted by value it is ~18, which is what the money actually did.
    assert.ok(result.blended_score > 17, `S was ${result.blended_score}`);
    assert.equal(result.band, "high");
  });
});

describe("clean quotations need no approval (B3.5)", () => {
  test("every line inside its limit scores zero and routes to nobody", () => {
    const result = evaluateRisk(
      [
        line({ line_id: 1, discount_pct: 10 }),
        line({ line_id: 2, discount_pct: 15 }),
      ],
      RULES,
    );
    assert.equal(result.blended_score, 0);
    assert.equal(result.worst_line_overage, 0);
    assert.equal(result.band, "low");
    assert.deepEqual(result.required_levels, []);
  });

  test("a discount exactly at the ceiling is compliant, not over", () => {
    // An off-by-one here would flag every deal a rep priced correctly.
    const result = evaluateRisk([line({ line_id: 1, discount_pct: 15 })], RULES);
    assert.equal(result.worst_line_overage, 0);
    assert.equal(result.lines[0]?.status, "ok");
  });
});

describe("degenerate inputs", () => {
  test("an empty quotation is low, not an error and not high", () => {
    const result = evaluateRisk([], RULES);
    assert.deepEqual(
      { s: result.blended_score, m: result.worst_line_overage, band: result.band },
      { s: 0, m: 0, band: "low" },
    );
  });

  test("a zero-value order does not divide by zero", () => {
    // Free lines: order list value is 0. S must be finite and M must still see
    // the overage.
    const result = evaluateRisk(
      [
        line({ line_id: 1, discount_pct: 30, list_value_cents: 0 }),
        line({ line_id: 2, discount_pct: 0, list_value_cents: 0 }),
      ],
      RULES,
    );
    assert.ok(Number.isFinite(result.blended_score));
    assert.equal(result.worst_line_overage, 15);
  });
});

describe("failing closed", () => {
  test("a missing category ceiling routes to the highest band", () => {
    // We cannot say whether this discount is within policy, so we do not say it
    // is. Under-approving is a margin loss nobody catches; over-approving is an
    // inconvenience somebody notices immediately.
    const result = evaluateRisk(
      [line({ line_id: 1, discount_pct: 5, category_ceiling_pct: null })],
      RULES,
    );
    assert.equal(result.band, "high");
    assert.equal(result.failed_closed, true);
  });

  test("a missing tier ceiling does the same", () => {
    const result = evaluateRisk(
      [line({ line_id: 1, discount_pct: 5, tier_ceiling_pct: null })],
      RULES,
    );
    assert.equal(result.band, "high");
  });

  test("an empty rules table demands both approval levels", () => {
    // Configuration lost is not permission granted.
    const result = evaluateRisk([line({ line_id: 1, discount_pct: 90 })], []);
    assert.deepEqual(result.required_levels, ["manager", "finance"]);
  });
});

describe("A3.3 — routing is configuration, not code", () => {
  test("tightening the thresholds re-routes the same quotation", () => {
    // One point over its ceiling. S = M = 1, which is under the seeded medium
    // thresholds (2 blended, 5 worst-line), so this deal needs nobody.
    const quote = [line({ line_id: 1, discount_pct: 16, category_ceiling_pct: 15 })];
    assert.equal(evaluateRisk(quote, RULES).band, "low");

    // Screen 18 saves a stricter table. Same quotation, same code, no deploy —
    // the routing changed because the ROWS changed. This is the concrete
    // answer to PS §7's "not hardcoded or faked for the demo".
    const strict: ApprovalChainRule[] = [
      { band: "low", min_blended_score: 0, min_worst_line: 0, required_levels: [] },
      { band: "medium", min_blended_score: 0.5, min_worst_line: 0.5, required_levels: ["manager"] },
      {
        band: "high",
        min_blended_score: 1,
        min_worst_line: 1,
        required_levels: ["manager", "finance"],
      },
    ];
    const rerouted = evaluateRisk(quote, strict);
    assert.equal(rerouted.band, "high");
    assert.deepEqual(rerouted.required_levels, ["manager", "finance"]);
  });
});

describe("the breakdown explains the score", () => {
  test("every line reports the reasoning screen 6 renders", () => {
    const result = evaluateRisk(
      [
        line({
          line_id: 7,
          label: "Onsite Setup Service (Services)",
          discount_pct: 18,
          category_ceiling_pct: 10,
          list_value_cents: 50_000,
        }),
        line({ line_id: 8, discount_pct: 0, list_value_cents: 50_000 }),
      ],
      RULES,
    );
    assert.deepEqual(result.lines[0], {
      line_id: 7,
      label: "Onsite Setup Service (Services)",
      discount_pct: 18,
      ceiling_pct: 10,
      overage_pct: 8,
      value_weight: 0.5,
      status: "over",
    });
  });

  test("the displayed overages are the ones the score was computed from", () => {
    // Screen 6 must never show a reason that does not add up to the band it is
    // explaining.
    const lines = [
      line({ line_id: 1, discount_pct: 21, list_value_cents: 300_000 }),
      line({ line_id: 2, discount_pct: 18, list_value_cents: 100_000 }),
    ];
    const result = evaluateRisk(lines, RULES);
    const recomputed = result.lines.reduce(
      (sum, l) => sum + l.overage_pct * l.value_weight,
      0,
    );
    assert.ok(
      Math.abs(recomputed - result.blended_score) < 0.001,
      `breakdown sums to ${recomputed}, score is ${result.blended_score}`,
    );
  });
});
