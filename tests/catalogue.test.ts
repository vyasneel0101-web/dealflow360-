/**
 * Catalogue endpoints (A2.1–A2.6), against a real database.
 *
 * The role assertions matter as much as the CRUD ones: PRD.md §3 puts backend
 * configuration behind admin, and a matrix that is only enforced in the UI is
 * not enforced at all.
 */
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { closePool, query, queryOne } from "../server/lib/db.ts";
import { resetRateLimits } from "../server/middleware/rateLimit.ts";
import {
  call,
  cleanupTestRows,
  databaseAvailable,
  startHarness,
  uniqueEmail,
  type Harness,
} from "./helpers.ts";
import type {
  ApiError,
  ApiSuccess,
  AuthResponse,
  Id,
  Paginated,
  PriceList,
  Product,
  ProductCategory,
  ProductVariant,
} from "../shared/types.ts";

const available = await databaseAvailable();
const harness: Harness | null = available ? await startHarness() : null;

function api(): Harness {
  if (harness === null) throw new Error("harness not started");
  return harness;
}

if (!available) {
  console.error("\n  SKIPPING catalogue tests — no database. Run `npm run db:setup`.\n");
}

/**
 * The seeded Hardware category, which every product these tests create hangs
 * off. Read rather than created, so the tests exercise the same rows the demo
 * does — a category invented by the test would not have the 15% ceiling the
 * risk engine later reads.
 */
let hardwareId: Id = 0;

if (available) {
  const row = await queryOne<{ id: Id }>(
    "SELECT id FROM product_categories WHERE name = 'Hardware'",
  );
  if (row === null) {
    console.error("\n  SKIPPING catalogue tests — database not seeded. Run `npm run db:seed`.\n");
  } else {
    hardwareId = row.id;
  }
}

const seeded = available && hardwareId !== 0;

beforeEach(() => {
  resetRateLimits();
});

after(async () => {
  if (!available) {
    await closePool();
    return;
  }
  await query("DELETE FROM products WHERE name LIKE 'TEST %'");
  await query("DELETE FROM price_lists WHERE name LIKE 'TEST %'");
  await cleanupTestRows();
  await api().stop();
});

/** Signs up a rep, then promotes it — role is never settable from a body. */
async function actor(role: "rep" | "manager" | "admin"): Promise<string> {
  const email = uniqueEmail(`cat-${role}`);
  const res = await call<ApiSuccess<AuthResponse>>(api(), "POST", "/api/auth/signup", {
    body: { email, password: "a-long-enough-test-password", full_name: `Test ${role}` },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  if (role !== "rep") {
    await query("UPDATE users SET role = $1 WHERE email = $2", [role, email]);
  }
  return res.body.data.token;
}

async function makeProduct(token: string, name: string, extra: Record<string, unknown> = {}) {
  return call<ApiSuccess<Product>>(api(), "POST", "/api/products", {
    token,
    body: {
      name,
      category_id: hardwareId,
      base_price_cents: 120_000,
      cost_cents: 82_000,
      unit: "Each",
      ...extra,
    },
  });
}

describe("A2.1 — product CRUD", { skip: !seeded }, () => {
  test("creates a product with all six PS fields and reads it back", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST Widget", {
      tax_pct: 8,
      description: "A widget for testing.",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const fetched = await call<ApiSuccess<Product>>(
      api(),
      "GET",
      `/api/products/${created.body.data.id}`,
      { token },
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.name, "TEST Widget");
    assert.equal(fetched.body.data.tax_pct, 8);
    // Joined from the category, which is what the risk engine will read.
    assert.equal(fetched.body.data.category_max_discount_pct, 15);
  });

  test("cost is required — without it margin is unimplementable", async () => {
    const token = await actor("admin");
    const res = await call<ApiError>(api(), "POST", "/api/products", {
      token,
      body: { name: "TEST No Cost", category_id: hardwareId, base_price_cents: 1000, unit: "Each" },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.fields?.cost_cents);
  });

  test("a patch changes only what it sends", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST Patchable");
    const id = created.body.data.id;

    const patched = await call<ApiSuccess<Product>>(api(), "PATCH", `/api/products/${id}`, {
      token,
      body: { base_price_cents: 99_000 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.base_price_cents, 99_000);
    // Untouched fields survive.
    assert.equal(patched.body.data.cost_cents, 82_000);
    assert.equal(patched.body.data.name, "TEST Patchable");
  });

  test("an unknown product is a 404, and a non-numeric id is too", async () => {
    const token = await actor("admin");
    assert.equal((await call(api(), "GET", "/api/products/99999999", { token })).status, 404);
    // Not a 500 from Number("abc") reaching SQL as NaN.
    assert.equal((await call(api(), "GET", "/api/products/abc", { token })).status, 404);
  });
});

describe("A2.6 — subscription products must be billable", { skip: !seeded }, () => {
  test("a subscription without an interval is refused with a readable message", async () => {
    const token = await actor("admin");
    const res = await call<ApiError>(api(), "POST", "/api/products", {
      token,
      body: {
        name: "TEST Unbillable",
        category_id: hardwareId,
        base_price_cents: 1000,
        cost_cents: 500,
        unit: "Recurring",
        is_subscription: true,
      },
    });
    // 422 with a sentence, not a 500 carrying a Postgres CHECK violation.
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /interval/i);
  });

  test("turning a product into a subscription mid-edit is checked too", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST Becomes Sub");
    const res = await call<ApiError>(
      api(),
      "PATCH",
      `/api/products/${created.body.data.id}`,
      { token, body: { is_subscription: true } },
    );
    // The rule applies to the RESULT of the edit, not to the fields sent —
    // the interval is absent from this request but still required.
    assert.equal(res.status, 422);
  });

  test("a subscription with an interval is accepted", async () => {
    const token = await actor("admin");
    const res = await makeProduct(token, "TEST Billable Sub", {
      is_subscription: true,
      recurring_interval: "monthly",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.recurring_interval, "monthly");
  });
});

describe("A2.4 — archive, never delete", { skip: !seeded }, () => {
  test("archiving hides a product from the default list but keeps the row", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST Archivable");
    const id = created.body.data.id;

    await call(api(), "PATCH", `/api/products/${id}/archive`, { token, body: { archived: true } });

    const active = await call<ApiSuccess<Paginated<Product>>>(
      api(),
      "GET",
      "/api/products?q=TEST%20Archivable",
      { token },
    );
    assert.equal(active.body.data.items.length, 0);

    const withArchived = await call<ApiSuccess<Paginated<Product>>>(
      api(),
      "GET",
      "/api/products?q=TEST%20Archivable&include_archived=true",
      { token },
    );
    assert.equal(withArchived.body.data.items.length, 1);

    // The row is still there — historical quotation lines reference it.
    const stillFetchable = await call<ApiSuccess<Product>>(api(), "GET", `/api/products/${id}`, {
      token,
    });
    assert.equal(stillFetchable.status, 200);
    assert.notEqual(stillFetchable.body.data.archived_at, null);
  });

  test("archiving is reversible", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST Restorable");
    const id = created.body.data.id;
    await call(api(), "PATCH", `/api/products/${id}/archive`, { token, body: { archived: true } });
    const restored = await call<ApiSuccess<Product>>(api(), "PATCH", `/api/products/${id}/archive`, {
      token,
      body: { archived: false },
    });
    assert.equal(restored.body.data.archived_at, null);
  });
});

describe("A2.2 — variants", { skip: !seeded }, () => {
  test("a variant is added and returned with the product", async () => {
    const token = await actor("admin");
    const created = await makeProduct(token, "TEST With Variants");
    const id = created.body.data.id;

    const variant = await call<ApiSuccess<ProductVariant>>(
      api(),
      "POST",
      `/api/products/${id}/variants`,
      { token, body: { attribute: "Memory", values: "16GB, 32GB", extra_price_cents: 15_000 } },
    );
    assert.equal(variant.status, 201);

    const fetched = await call<ApiSuccess<Product>>(api(), "GET", `/api/products/${id}`, { token });
    assert.equal(fetched.body.data.variants.length, 1);
    assert.equal(fetched.body.data.variants[0]?.extra_price_cents, 15_000);
  });

  test("deleting a variant through the wrong product is a 404", async () => {
    const token = await actor("admin");
    const a = await makeProduct(token, "TEST Variant Owner");
    const b = await makeProduct(token, "TEST Variant Stranger");

    const variant = await call<ApiSuccess<ProductVariant>>(
      api(),
      "POST",
      `/api/products/${a.body.data.id}/variants`,
      { token, body: { attribute: "Colour", values: "Black" } },
    );

    const res = await call(
      api(),
      "DELETE",
      `/api/products/${b.body.data.id}/variants/${variant.body.data.id}`,
      { token },
    );
    // Scoped in the SQL, so it cannot be forgotten by a handler.
    assert.equal(res.status, 404);
  });
});

describe("A2.3 / A2.5 — price lists are formulas", { skip: !seeded }, () => {
  test("a percent-off list is stored as a rule, not a price table", async () => {
    const token = await actor("admin");
    const res = await call<ApiSuccess<PriceList>>(api(), "POST", "/api/price-lists", {
      token,
      body: { name: "TEST Ten Off", rule_type: "percent_off", rule_value: 10 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.rule_type, "percent_off");
    assert.equal(res.body.data.rule_value, 10);
  });

  test("a percent-off rule over 100 is refused as a business rule, not a format error", async () => {
    const token = await actor("admin");
    const res = await call<ApiError>(api(), "POST", "/api/price-lists", {
      token,
      body: { name: "TEST Impossible", rule_type: "percent_off", rule_value: 150 },
    });
    // 422, not 400, and that distinction is real: 150 is a perfectly valid
    // rule_value for a `fixed` rule ($150). The validator cannot range-check
    // one field against another field's value, so the coherence of the pair is
    // the service's job. Left at the validator, this would either wave through
    // a list that prices the whole catalogue at zero, or reject legitimate
    // fixed prices over 100.
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /between 0 and 100/);
  });

  test("an override can be set twice without erroring", async () => {
    const token = await actor("admin");
    const list = await call<ApiSuccess<PriceList>>(api(), "POST", "/api/price-lists", {
      token,
      body: { name: "TEST Upsertable", rule_type: "none" },
    });
    const product = await makeProduct(token, "TEST Overridden");

    const first = await call(api(), "PUT", `/api/price-lists/${list.body.data.id}/items`, {
      token,
      body: { product_id: product.body.data.id, price_cents: 100_000 },
    });
    const second = await call<ApiSuccess<{ price_cents: number }>>(
      api(),
      "PUT",
      `/api/price-lists/${list.body.data.id}/items`,
      { token, body: { product_id: product.body.data.id, price_cents: 95_000 } },
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.price_cents, 95_000);
  });
});

describe("PRD §3 — the permission matrix is enforced server-side", { skip: !seeded }, () => {
  test("a rep cannot create a product", async () => {
    const res = await makeProduct(await actor("rep"), "TEST Rep Product");
    assert.equal(res.status, 403);
  });

  test("a manager cannot create a product either — that is admin config", async () => {
    const res = await makeProduct(await actor("manager"), "TEST Manager Product");
    assert.equal(res.status, 403);
  });

  test("a rep CAN read the catalogue — they build quotes from it", async () => {
    const res = await call(api(), "GET", "/api/products", { token: await actor("rep") });
    assert.equal(res.status, 200);
  });

  test("a manager can configure discount tiers, per the matrix", async () => {
    const token = await actor("manager");
    const res = await call<ApiSuccess<ProductCategory>>(api(), "POST", "/api/tiers", {
      token,
      body: { name: `TEST Tier ${Date.now()}`, max_discount_pct: 12 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await query("DELETE FROM customer_tiers WHERE name LIKE 'TEST Tier%'");
  });

  test("a rep cannot configure discount tiers", async () => {
    const res = await call(api(), "POST", "/api/tiers", {
      token: await actor("rep"),
      body: { name: "TEST Rep Tier", max_discount_pct: 99 },
    });
    assert.equal(res.status, 403);
  });

  test("no session at all is a 401, not a 403", async () => {
    const res = await call(api(), "GET", "/api/products");
    assert.equal(res.status, 401);
  });
});

describe("mass assignment", { skip: !seeded }, () => {
  test("a computed field cannot be set from a request body", async () => {
    const token = await actor("admin");
    const res = await call<ApiError>(api(), "POST", "/api/products", {
      token,
      body: {
        name: "TEST Sneaky",
        category_id: hardwareId,
        base_price_cents: 1000,
        cost_cents: 500,
        unit: "Each",
        archived_at: null,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.fields?.archived_at ?? "", /not a field/);
  });
});
