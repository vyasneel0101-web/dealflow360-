/**
 * Quotation building, end to end through the real API.
 *
 * `tests/risk.test.ts` proves the arithmetic. This file proves the WIRING: that
 * the score the engine computes is the score that reaches the client, that
 * every mutation returns a fully recomputed quotation, and that the per-line
 * ceiling and overage are persisted rather than only returned.
 */
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query, queryOne } from "../server/lib/db.ts";
import { resetRateLimits } from "../server/middleware/rateLimit.ts";
import {
  call,
  databaseAvailable,
  namespace,
  startHarness,
  type Harness,
} from "./helpers.ts";

import type {
  ApiError,
  ApiSuccess,
  AuthResponse,
  Id,
  QuotationDetail,
} from "../shared/types.ts";

/** This file's private slice of the database — see helpers.ts. */
const ns = namespace("quote");
const uniqueEmail = ns.email;


const available = await databaseAvailable();
const harness: Harness | null = available ? await startHarness() : null;

function api(): Harness {
  if (harness === null) throw new Error("harness not started");
  return harness;
}

/** Seeded fixtures, read rather than invented — the demo uses these same rows. */
interface Fixtures {
  goldCustomer: Id;
  laptop: Id;
  setupService: Id;
}
let fx: Fixtures | null = null;

if (available) {
  const row = await queryOne<Fixtures>(
    `SELECT (SELECT id FROM customers WHERE name = 'Acme Corp')            AS "goldCustomer",
            (SELECT id FROM products  WHERE name = 'Laptop Pro 14')        AS laptop,
            (SELECT id FROM products  WHERE name = 'Onsite Setup Service') AS "setupService"`,
  );
  if (row?.goldCustomer && row.laptop && row.setupService) fx = row;
  else console.error("\n  SKIPPING quotation tests — database not seeded. Run `npm run db:seed`.\n");
} else {
  console.error("\n  SKIPPING quotation tests — no database. Run `npm run db:setup`.\n");
}

const ready = available && fx !== null;
function f(): Fixtures {
  if (fx === null) throw new Error("fixtures not loaded");
  return fx;
}

beforeEach(() => {
  resetRateLimits();
});

after(async () => {
  if (!available) {
    await closePool();
    return;
  }
  await ns.cleanup();
  await api().stop();
});

async function repToken(): Promise<string> {
  const email = uniqueEmail("quote-rep");
  const res = await call<ApiSuccess<AuthResponse>>(api(), "POST", "/api/auth/signup", {
    body: { email, password: "a-long-enough-test-password", full_name: "Quote Rep" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.token;
}

async function newQuotation(token: string): Promise<QuotationDetail> {
  const res = await call<ApiSuccess<QuotationDetail>>(api(), "POST", "/api/quotations", {
    token,
    body: { customer_id: f().goldCustomer },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

function addLine(
  token: string,
  quotationId: Id,
  body: { product_id: Id; qty: number; discount_pct: number },
) {
  return call<ApiSuccess<QuotationDetail>>(api(), "POST", `/api/quotations/${quotationId}/lines`, {
    token,
    body,
  });
}

describe("PS §10 — the worked example, through the API", { skip: !ready }, () => {
  /**
   * Q-1042 as DB_SCHEMA.md §12 specifies: Acme Corp is Gold (tier ceiling 15).
   * Laptop 3 × 12% against Hardware's 15 is fine. Setup Service 1 × 18%
   * against Services' 10 is 8 points over.
   */
  async function buildQ1042(token: string): Promise<QuotationDetail> {
    const quote = await newQuotation(token);
    await addLine(token, quote.id, { product_id: f().laptop, qty: 3, discount_pct: 12 });
    const final = await addLine(token, quote.id, {
      product_id: f().setupService,
      qty: 1,
      discount_pct: 18,
    });
    return final.body.data;
  }

  test("the stricter ceiling applies and the service line reads OVER +8pt", async () => {
    const detail = await buildQ1042(await repToken());

    const laptop = detail.lines.find((l) => l.product_name === "Laptop Pro 14");
    const service = detail.lines.find((l) => l.product_name === "Onsite Setup Service");

    assert.equal(laptop?.ceiling_pct, 15);
    assert.equal(laptop?.overage_pct, 0);
    // Gold's 15% does not license 15% on a Services line capped at 10%.
    assert.equal(service?.ceiling_pct, 10);
    assert.equal(service?.overage_pct, 8);
  });

  test("one bad line flags the whole quotation despite a low blended score", async () => {
    const detail = await buildQ1042(await repToken());

    // The service line is a small share of the order, so S stays well under
    // the medium threshold of 2. Routing on S alone would let this through —
    // the exact failure PS §10 describes.
    assert.ok(detail.risk.blended_score < 2, `S was ${detail.risk.blended_score}`);
    assert.equal(detail.risk.worst_line_overage, 8);
    assert.equal(detail.risk.band, "medium");
    assert.deepEqual(detail.risk.required_levels, ["manager"]);
  });

  test("the per-line reasoning screen 6 renders comes back with it", async () => {
    const detail = await buildQ1042(await repToken());
    const over = detail.risk.lines.find((l) => l.status === "over");
    assert.equal(over?.label, "Onsite Setup Service (Services)");
    assert.equal(over?.discount_pct, 18);
    assert.equal(over?.ceiling_pct, 10);
    assert.equal(over?.overage_pct, 8);
  });
});

describe("every mutation returns the fully recomputed quotation", { skip: !ready }, () => {
  test("adding a line returns totals, margin and risk in one response", async () => {
    const token = await repToken();
    const quote = await newQuotation(token);
    const res = await addLine(token, quote.id, {
      product_id: f().laptop,
      qty: 2,
      discount_pct: 10,
    });

    const detail = res.body.data;
    // The client derives nothing: everything screen 4 shows is in this payload.
    assert.equal(detail.lines.length, 1);
    assert.ok(detail.totals.total_cents > 0);
    assert.ok(detail.totals.margin_cents !== 0);
    assert.equal(typeof detail.risk.blended_score, "number");
    assert.equal(typeof detail.risk.band, "string");
  });

  test("changing a discount re-routes the band in the same response", async () => {
    const token = await repToken();
    const quote = await newQuotation(token);
    const added = await addLine(token, quote.id, {
      product_id: f().laptop,
      qty: 1,
      discount_pct: 10,
    });
    assert.equal(added.body.data.risk.band, "low");

    const lineId = added.body.data.lines[0]?.id;
    const patched = await call<ApiSuccess<QuotationDetail>>(
      api(),
      "PATCH",
      `/api/quotations/${quote.id}/lines/${lineId}`,
      { token, body: { discount_pct: 40 } },
    );

    // 40 against a ceiling of 15 is 25 points over — high, and the whole
    // recomputed quotation comes back from the PATCH itself.
    assert.equal(patched.body.data.risk.worst_line_overage, 25);
    assert.equal(patched.body.data.risk.band, "high");
    assert.deepEqual(patched.body.data.risk.required_levels, ["manager", "finance"]);
  });

  test("deleting the offending line drops the quotation back to low", async () => {
    const token = await repToken();
    const quote = await newQuotation(token);
    await addLine(token, quote.id, { product_id: f().laptop, qty: 1, discount_pct: 5 });
    const withBad = await addLine(token, quote.id, {
      product_id: f().setupService,
      qty: 1,
      discount_pct: 45,
    });
    assert.equal(withBad.body.data.risk.band, "high");

    const badLine = withBad.body.data.lines.find((l) => l.discount_pct === 45);
    const afterDelete = await call<ApiSuccess<QuotationDetail>>(
      api(),
      "DELETE",
      `/api/quotations/${quote.id}/lines/${badLine?.id}`,
      { token },
    );
    assert.equal(afterDelete.body.data.risk.band, "low");
    assert.equal(afterDelete.body.data.risk.worst_line_overage, 0);
  });

  test("the per-line ceiling and overage are PERSISTED, not just returned", async () => {
    // Screen 4's Limit/Status columns must render stored facts that agree with
    // the score that actually routed the deal (DB_SCHEMA.md §5).
    const token = await repToken();
    const quote = await newQuotation(token);
    const added = await addLine(token, quote.id, {
      product_id: f().setupService,
      qty: 1,
      discount_pct: 18,
    });

    const stored = await queryOne<{ ceiling_pct: number; overage_pct: number }>(
      "SELECT ceiling_pct, overage_pct FROM quotation_lines WHERE id = $1",
      [added.body.data.lines[0]?.id],
    );
    assert.equal(stored?.ceiling_pct, 10);
    assert.equal(stored?.overage_pct, 8);

    const cached = await queryOne<{
      risk_band: string;
      worst_line_overage: number;
      blended_score: number;
    }>(
      "SELECT risk_band, worst_line_overage, blended_score FROM quotations WHERE id = $1",
      [quote.id],
    );
    // High, not medium — and the difference from the Q-1042 case above is the
    // whole point of value weighting. Here the offending line IS the order, so
    // its weight is 1 and S = M = 8, clearing the high threshold of 5. In
    // Q-1042 the same line sits beside a laptop carrying 8/9 of the value, so
    // S falls to 0.889 and only M escalates it.
    assert.equal(cached?.blended_score, 8);
    assert.equal(cached?.risk_band, "high");
    assert.equal(cached?.worst_line_overage, 8);
  });
});

describe("price and cost are snapshotted onto the line", { skip: !ready }, () => {
  test("editing the product's price afterwards does not rewrite the quotation", async () => {
    // The reason snapshotting exists: an approval recorded against terms that
    // no longer exist is worse than useless, it is a false audit record.
    const token = await repToken();
    const quote = await newQuotation(token);
    const added = await addLine(token, quote.id, {
      product_id: f().laptop,
      qty: 1,
      discount_pct: 0,
    });
    const originalPrice = added.body.data.lines[0]?.unit_price_cents;

    await query("UPDATE products SET base_price_cents = base_price_cents + 50000 WHERE id = $1", [
      f().laptop,
    ]);
    try {
      const reloaded = await call<ApiSuccess<QuotationDetail>>(
        api(),
        "GET",
        `/api/quotations/${quote.id}`,
        { token },
      );
      assert.equal(reloaded.body.data.lines[0]?.unit_price_cents, originalPrice);
    } finally {
      await query("UPDATE products SET base_price_cents = base_price_cents - 50000 WHERE id = $1", [
        f().laptop,
      ]);
    }
  });

  test("the Gold price list override is applied at add time", async () => {
    // Seed sets an explicit override of $1,040 for the laptop on Gold Partner
    // Pricing, which beats both the 10% rule and the $1,200 base.
    const token = await repToken();
    const quote = await newQuotation(token);
    const added = await addLine(token, quote.id, {
      product_id: f().laptop,
      qty: 1,
      discount_pct: 0,
    });
    assert.equal(added.body.data.lines[0]?.unit_price_cents, 104_000);
  });
});

describe("editing rules", { skip: !ready }, () => {
  test("a rep cannot edit another rep's quotation", async () => {
    const owner = await repToken();
    const stranger = await repToken();
    const quote = await newQuotation(owner);

    const res = await addLine(stranger, quote.id, {
      product_id: f().laptop,
      qty: 1,
      discount_pct: 0,
    });
    assert.equal(res.status, 403);
  });

  test("a confirmed quotation's terms can no longer change", async () => {
    const token = await repToken();
    const quote = await newQuotation(token);
    await query("UPDATE quotations SET status = 'confirmed' WHERE id = $1", [quote.id]);

    const res = await addLine(token, quote.id, {
      product_id: f().laptop,
      qty: 1,
      discount_pct: 0,
    });
    // 409, not 403 — the user is permitted, the state is not.
    assert.equal(res.status, 409);
  });

  test("an archived product cannot be added to a new quotation", async () => {
    const token = await repToken();
    const quote = await newQuotation(token);
    await query("UPDATE products SET archived_at = now() WHERE id = $1", [f().setupService]);
    try {
      const res = await addLine(token, quote.id, {
        product_id: f().setupService,
        qty: 1,
        discount_pct: 0,
      });
      assert.equal(res.status, 422);
    } finally {
      await query("UPDATE products SET archived_at = NULL WHERE id = $1", [f().setupService]);
    }
  });

  test("a line belonging to another quotation is a 404", async () => {
    const token = await repToken();
    const a = await newQuotation(token);
    const b = await newQuotation(token);
    const added = await addLine(token, a.id, { product_id: f().laptop, qty: 1, discount_pct: 0 });

    const res = await call<ApiError>(
      api(),
      "PATCH",
      `/api/quotations/${b.id}/lines/${added.body.data.lines[0]?.id}`,
      { token, body: { qty: 5 } },
    );
    assert.equal(res.status, 404);
  });
});

describe("B3.3 — an order discount is visible to governance", { skip: !ready }, () => {
  test("it writes through to every line, so the risk engine scores it", async () => {
    // An order-level discount held outside the lines would be invisible to the
    // score — exactly the hole PS §10 describes.
    const token = await repToken();
    const quote = await newQuotation(token);
    await addLine(token, quote.id, { product_id: f().laptop, qty: 2, discount_pct: 0 });
    await addLine(token, quote.id, { product_id: f().setupService, qty: 1, discount_pct: 0 });

    const res = await call<ApiSuccess<QuotationDetail>>(
      api(),
      "POST",
      `/api/quotations/${quote.id}/order-discount`,
      { token, body: { discount_pct: 25 } },
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.lines.every((l) => l.discount_pct === 25));
    // Hardware ceiling 15 → 10 over; Services ceiling 10 → 15 over.
    assert.equal(res.body.data.risk.worst_line_overage, 15);
    assert.equal(res.body.data.risk.band, "high");
  });
});

describe("A3.3 — routing is rows, not code", { skip: !ready }, () => {
  test("the chain rules are readable and the seeded values are the documented ones", async () => {
    const res = await call<ApiSuccess<{ band: string; min_blended_score: number }[]>>(
      api(),
      "GET",
      "/api/approval-chain",
      { token: await repToken() },
    );
    assert.equal(res.status, 200);
    const medium = res.body.data.find((r) => r.band === "medium");
    assert.equal(medium?.min_blended_score, 2);
  });

  test("a rep cannot rewrite the routing table", async () => {
    const res = await call(api(), "PUT", "/api/approval-chain", {
      token: await repToken(),
      body: {
        band: "high",
        min_blended_score: 99,
        min_worst_line: 99,
        required_levels: "manager",
      },
    });
    assert.equal(res.status, 403);
  });
});
