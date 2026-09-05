/**
 * Seed data (DB_SCHEMA.md §12). `npm run db:seed`.
 *
 * Not decoration. The values here are chosen so that PS §9's eight-step
 * acceptance walkthrough can actually be walked, and so the numbers on screen
 * match the numbers in the wireframe — a demo where the screenshots and the
 * running app disagree invites exactly the question you do not want.
 *
 * Two properties:
 *   - Everything runs in ONE transaction. A seed that fails halfway leaves a
 *     half-populated database that looks fine until the demo hits the gap.
 *   - Re-running is refused rather than duplicated. `npm run db:reset` is the
 *     way back to a known state, and it is one command on purpose.
 */
import process from "node:process";
import { closePool, pool, withTransaction } from "../../server/lib/db.ts";
import { hashPassword } from "../../server/lib/crypto.ts";
import type pg from "pg";

/**
 * Demo credentials. Distinct per role so a judge can see the permission matrix
 * actually bite — logging in as the rep and finding the admin screens refused
 * is the point. Non-obvious rather than "password", because a demo full of
 * `admin/admin` reads as carelessness even when nothing is at risk.
 *
 * Documented in the README. Rotated or removed in Phase 6.
 */
const USERS = [
  { email: "admin@dealflow.local", full_name: "Ana Oyelaran", role: "admin", password: "cedar-lattice-9471" },
  { email: "manager@dealflow.local", full_name: "Marcus Hale", role: "manager", password: "harbor-kestrel-3820" },
  { email: "finance@dealflow.local", full_name: "Priya Raman", role: "finance", password: "quartz-meridian-6155" },
  { email: "rep@dealflow.local", full_name: "Tomas Vidal", role: "rep", password: "willow-cadence-2748" },
  { email: "rep2@dealflow.local", full_name: "Sana Iqbal", role: "rep", password: "basalt-orchard-5093" },
] as const;

async function alreadySeeded(): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM customer_tiers");
  return (rows[0]?.n ?? 0) > 0;
}

/** Small helper: insert and hand back the new id, which every later insert needs. */
async function id(client: pg.PoolClient, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query<{ id: number }>(sql, params);
  const value = rows[0]?.id;
  if (value === undefined) throw new Error(`Seed insert returned no id: ${sql.slice(0, 60)}`);
  return value;
}

async function seed(): Promise<void> {
  if (await alreadySeeded()) {
    console.log(
      "Database already contains seed data — nothing done.\n" +
        "Run `npm run db:reset` to rebuild from scratch.",
    );
    return;
  }

  await withTransaction(async (client) => {
    // ── Teams ────────────────────────────────────────────────────────────────
    const teamNorth = await id(client, "INSERT INTO sales_teams (name) VALUES ($1) RETURNING id", [
      "North Region",
    ]);
    const teamSouth = await id(client, "INSERT INTO sales_teams (name) VALUES ($1) RETURNING id", [
      "South Region",
    ]);

    // ── Users ────────────────────────────────────────────────────────────────
    // Hashed in parallel: Argon2id at 19 MiB is deliberately slow, and five
    // sequential hashes is a noticeable pause on `npm run db:reset`.
    const hashes = await Promise.all(USERS.map((u) => hashPassword(u.password)));
    for (const [index, user] of USERS.entries()) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, sales_team_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.email,
          hashes[index],
          user.full_name,
          user.role,
          user.role === "rep" ? (index % 2 === 0 ? teamNorth : teamSouth) : null,
        ],
      );
    }

    // ── Tiers ────────────────────────────────────────────────────────────────
    // The tier half of every per-line ceiling. Values, not constants — PS §7's
    // "not hardcoded or faked for the demo" is answered by these being rows.
    const bronze = await id(
      client,
      "INSERT INTO customer_tiers (name, max_discount_pct, sort_order) VALUES ($1, $2, $3) RETURNING id",
      ["Bronze", 5, 1],
    );
    const silver = await id(
      client,
      "INSERT INTO customer_tiers (name, max_discount_pct, sort_order) VALUES ($1, $2, $3) RETURNING id",
      ["Silver", 10, 2],
    );
    const gold = await id(
      client,
      "INSERT INTO customer_tiers (name, max_discount_pct, sort_order) VALUES ($1, $2, $3) RETURNING id",
      ["Gold", 15, 3],
    );

    // ── Categories ───────────────────────────────────────────────────────────
    // The category half. Services at 10 against Gold's 15 is what makes the
    // PS §10 worked example produce an over-limit line at all: min(15, 10) = 10,
    // and the Setup Service line is discounted 18%.
    const hardware = await id(
      client,
      "INSERT INTO product_categories (name, max_discount_pct) VALUES ($1, $2) RETURNING id",
      ["Hardware", 15],
    );
    const services = await id(
      client,
      "INSERT INTO product_categories (name, max_discount_pct) VALUES ($1, $2) RETURNING id",
      ["Services", 10],
    );
    const subscription = await id(
      client,
      "INSERT INTO product_categories (name, max_discount_pct) VALUES ($1, $2) RETURNING id",
      ["Subscription", 10],
    );

    // ── Customers & contacts ─────────────────────────────────────────────────
    const customers = [
      { name: "Acme Corp", tier: gold, email: "procurement@acme.test" },
      { name: "Beta Industries", tier: silver, email: "buying@beta.test" },
      { name: "Nova Retail", tier: silver, email: "ops@nova.test" },
      { name: "Zenith Co", tier: bronze, email: "accounts@zenith.test" },
      { name: "Orion Ltd", tier: bronze, email: "purchasing@orion.test" },
      { name: "Delta LLC", tier: gold, email: "finance@delta.test" },
    ];
    const customerIds: Record<string, number> = {};
    for (const customer of customers) {
      customerIds[customer.name] = await id(
        client,
        "INSERT INTO customers (name, tier_id, email) VALUES ($1, $2, $3) RETURNING id",
        [customer.name, customer.tier, customer.email],
      );
    }

    // Portal identities. Deliberately in `contacts`, not `users` — a customer
    // has no representation the internal system can express (DB_SCHEMA.md §2).
    // No password: the primary path is the magic link (A1.2).
    const contacts = [
      { customer: "Acme Corp", email: "dana.whitfield@acme.test", name: "Dana Whitfield" },
      { customer: "Beta Industries", email: "raj.patel@beta.test", name: "Raj Patel" },
      { customer: "Nova Retail", email: "lin.zhao@nova.test", name: "Lin Zhao" },
      { customer: "Delta LLC", email: "sam.okafor@delta.test", name: "Sam Okafor" },
    ];
    for (const contact of contacts) {
      await client.query(
        "INSERT INTO contacts (customer_id, email, full_name) VALUES ($1, $2, $3)",
        [customerIds[contact.customer], contact.email, contact.name],
      );
    }

    // ── Products ─────────────────────────────────────────────────────────────
    // Costs are realistic rather than round, so margin figures are non-trivial
    // and the upsell panel's margin-delta filter has something to discriminate
    // on. A catalogue where everything is 50% margin tests nothing.
    const products = [
      { key: "laptop", name: "Laptop Pro 14", cat: hardware, price: 120_000, cost: 82_000, unit: "Each", tax: 8, promoted: false, desc: "14-inch business laptop, 16GB RAM, 512GB SSD." },
      { key: "setup", name: "Onsite Setup Service", cat: services, price: 45_000, cost: 21_000, unit: "Each", tax: 0, promoted: false, desc: "Engineer on site for provisioning and handover." },
      { key: "warranty", name: "Extended Warranty", cat: services, price: 18_000, cost: 6_500, unit: "Each", tax: 0, promoted: true, desc: "Three-year parts and labour cover." },
      { key: "dock", name: "Docking Station", cat: hardware, price: 18_000, cost: 11_200, unit: "Each", tax: 8, promoted: true, desc: "Dual-display USB-C dock with power delivery." },
      { key: "mouse", name: "Wireless Mouse", cat: hardware, price: 4_500, cost: 1_900, unit: "Each", tax: 8, promoted: false, desc: "Bluetooth mouse, rechargeable." },
      { key: "monitor", name: "27-inch Monitor", cat: hardware, price: 32_000, cost: 21_500, unit: "Each", tax: 8, promoted: false, desc: "27-inch QHD display, height adjustable." },
    ];
    const productIds: Record<string, number> = {};
    for (const p of products) {
      productIds[p.key] = await id(
        client,
        `INSERT INTO products
           (name, category_id, base_price_cents, cost_cents, unit, tax_pct, description, is_promoted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [p.name, p.cat, p.price, p.cost, p.unit, p.tax, p.desc, p.promoted],
      );
    }

    // Subscription products. The CHECK constraint refuses these without an
    // interval, which is the point — an unbillable subscription is a silent
    // revenue bug (A2.6).
    const recurring = [
      { key: "careplan", name: "Care Plan 2yr", price: 4_000, cost: 1_400, interval: "monthly", desc: "Monthly device care and replacement cover." },
      { key: "sla", name: "Support SLA", price: 9_500, cost: 3_800, interval: "monthly", desc: "Four-hour response support agreement." },
    ];
    for (const s of recurring) {
      productIds[s.key] = await id(
        client,
        `INSERT INTO products
           (name, category_id, base_price_cents, cost_cents, unit, tax_pct, description,
            is_subscription, recurring_interval)
         VALUES ($1, $2, $3, $4, 'Recurring', 0, $5, true, $6) RETURNING id`,
        [s.name, subscription, s.price, s.cost, s.desc, s.interval],
      );
    }

    // ── Variants (A2.2) ──────────────────────────────────────────────────────
    // Flat attribute rows, exactly as wireframe screen 17 draws the table.
    await client.query(
      `INSERT INTO product_variants (product_id, attribute, values, extra_price_cents) VALUES
         ($1, 'Memory',  '16GB, 32GB',        15000),
         ($1, 'Storage', '512GB, 1TB',        12000),
         ($2, 'Colour',  'Black, Silver',         0)`,
      [productIds.laptop, productIds.dock],
    );

    // ── Price lists (A2.3, A2.5) ─────────────────────────────────────────────
    // Stored formulas, not price tables. Screen 17's "Price minus 10 percent
    // base" is exactly rule_type='percent_off', rule_value=10.
    const goldList = await id(
      client,
      `INSERT INTO price_lists (name, tier_id, currency, rule_type, rule_value)
       VALUES ($1, $2, 'USD', 'percent_off', 10) RETURNING id`,
      ["Gold Partner Pricing", gold],
    );
    await id(
      client,
      `INSERT INTO price_lists (name, tier_id, currency, rule_type, rule_value)
       VALUES ($1, $2, 'USD', 'percent_off', 5) RETURNING id`,
      ["Silver Pricing", silver],
    );
    await id(
      client,
      `INSERT INTO price_lists (name, tier_id, currency, rule_type, rule_value)
       VALUES ($1, $2, 'USD', 'none', 0) RETURNING id`,
      ["Standard List", bronze],
    );
    // A2.3's "currency specific rules": a EUR list with its own rule, which is
    // in scope, as distinct from application-wide conversion, which is BONUS.
    await id(
      client,
      `INSERT INTO price_lists (name, tier_id, currency, rule_type, rule_value)
       VALUES ($1, NULL, 'EUR', 'percent_off', 8) RETURNING id`,
      ["EU Distributor (EUR)"],
    );

    // One explicit override, so step 1 of the three-step resolution is
    // exercised by the seed rather than only by a test.
    await client.query(
      `INSERT INTO price_list_items (price_list_id, product_id, price_cents) VALUES ($1, $2, $3)`,
      [goldList, productIds.laptop, 104_000],
    );

    // ── Warehouses & stock ───────────────────────────────────────────────────
    // shipping_cost_weight is the split objective's input: East Depot is
    // cheaper, so the greedy split prefers it when it can fill a line whole.
    const main = await id(
      client,
      "INSERT INTO warehouses (name, shipping_cost_weight) VALUES ($1, $2) RETURNING id",
      ["Main Warehouse", 1.0],
    );
    const east = await id(
      client,
      "INSERT INTO warehouses (name, shipping_cost_weight) VALUES ($1, $2) RETURNING id",
      ["East Depot", 0.8],
    );

    // Laptop at 40/18 and 10/6 matches wireframe screen 7 exactly, so the
    // demo and the screenshots agree.
    const stock: [number, string, number, number][] = [
      [main, "laptop", 40, 18],
      [east, "laptop", 10, 6],
      [main, "setup", 999, 0],
      [main, "warranty", 999, 0],
      [main, "dock", 60, 12],
      [east, "dock", 25, 0],
      [main, "mouse", 200, 30],
      [east, "mouse", 90, 10],
      [main, "monitor", 18, 4],
      [east, "monitor", 6, 6],
    ];
    for (const [warehouse, key, onHand, reserved] of stock) {
      await client.query(
        "INSERT INTO stock (warehouse_id, product_id, on_hand, reserved) VALUES ($1, $2, $3, $4)",
        [warehouse, productIds[key], onHand, reserved],
      );
    }

    // Reorder points, so the fulfillment screen has something to flag.
    await client.query(
      `INSERT INTO replenishment_rules (warehouse_id, product_id, min_qty, reorder_qty) VALUES
         ($1, $2, 15, 40), ($3, $4, 5, 20)`,
      [main, productIds.laptop, east, productIds.monitor],
    );
  });

  console.log("Seeded. Sign in with any of:\n");
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(8)} ${user.email.padEnd(26)} ${user.password}`);
  }
  console.log("\nThese are demo accounts on a local database (README).\n");
}

try {
  await seed();
} catch (error) {
  console.error(`\nSeeding failed. ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
