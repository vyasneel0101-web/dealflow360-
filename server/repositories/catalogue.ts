/**
 * Parameterised SQL for the catalogue: categories, tiers, products, variants,
 * price lists. No business logic — that lives in services (TRD.md §2).
 */
import { query, queryOne, type Queryable } from "../lib/db.ts";
import type {
  Cents,
  CurrencyCode,
  Customer,
  CustomerTier,
  Id,
  Percent,
  PriceList,
  PriceRuleType,
  Product,
  ProductCategory,
  ProductVariant,
  RecurringInterval,
} from "../../shared/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Categories & tiers — the two ceiling tables the risk engine reads
// ─────────────────────────────────────────────────────────────────────────────

export function listCategories(client?: Queryable): Promise<ProductCategory[]> {
  return query<ProductCategory>(
    "SELECT id, name, max_discount_pct FROM product_categories ORDER BY name",
    [],
    client,
  );
}

export function insertCategory(
  input: { name: string; max_discount_pct: Percent },
  client?: Queryable,
): Promise<ProductCategory | null> {
  return queryOne<ProductCategory>(
    `INSERT INTO product_categories (name, max_discount_pct)
     VALUES ($1, $2)
     RETURNING id, name, max_discount_pct`,
    [input.name, input.max_discount_pct],
    client,
  );
}

/**
 * COALESCE against the incoming value means an absent field keeps its current
 * value, so one function serves any subset of columns. The validator has
 * already rejected anything not in the whitelist, so `undefined` here always
 * means "not sent" and never "sent as garbage".
 */
export function updateCategory(
  id: Id,
  input: { name?: string; max_discount_pct?: Percent },
  client?: Queryable,
): Promise<ProductCategory | null> {
  return queryOne<ProductCategory>(
    `UPDATE product_categories
        SET name             = COALESCE($2, name),
            max_discount_pct = COALESCE($3, max_discount_pct)
      WHERE id = $1
      RETURNING id, name, max_discount_pct`,
    [id, input.name ?? null, input.max_discount_pct ?? null],
    client,
  );
}

export function listTiers(client?: Queryable): Promise<CustomerTier[]> {
  return query<CustomerTier>(
    "SELECT id, name, max_discount_pct, sort_order FROM customer_tiers ORDER BY sort_order, name",
    [],
    client,
  );
}

export function insertTier(
  input: { name: string; max_discount_pct: Percent; sort_order: number },
  client?: Queryable,
): Promise<CustomerTier | null> {
  return queryOne<CustomerTier>(
    `INSERT INTO customer_tiers (name, max_discount_pct, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, name, max_discount_pct, sort_order`,
    [input.name, input.max_discount_pct, input.sort_order],
    client,
  );
}

export function updateTier(
  id: Id,
  input: { name?: string; max_discount_pct?: Percent; sort_order?: number },
  client?: Queryable,
): Promise<CustomerTier | null> {
  return queryOne<CustomerTier>(
    `UPDATE customer_tiers
        SET name             = COALESCE($2, name),
            max_discount_pct = COALESCE($3, max_discount_pct),
            sort_order       = COALESCE($4, sort_order)
      WHERE id = $1
      RETURNING id, name, max_discount_pct, sort_order`,
    [id, input.name ?? null, input.max_discount_pct ?? null, input.sort_order ?? null],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers
//
// Read-only for now: a rep needs the list to open a quotation against someone.
// Customer administration is not a screen the wireframe draws.
// ─────────────────────────────────────────────────────────────────────────────

interface CustomerRow extends Omit<Customer, "archived_at"> {
  archived_at: Date | null;
}

export async function listCustomers(
  includeArchived: boolean,
  client?: Queryable,
): Promise<Customer[]> {
  const rows = await query<CustomerRow>(
    `SELECT c.id, c.name, c.tier_id, t.name AS tier_name,
            t.max_discount_pct AS tier_max_discount_pct,
            c.email, c.currency, c.archived_at
       FROM customers c
       JOIN customer_tiers t ON t.id = c.tier_id
      WHERE ($1::boolean OR c.archived_at IS NULL)
      ORDER BY c.name`,
    [includeArchived],
    client,
  );
  return rows.map((row) => ({ ...row, archived_at: row.archived_at?.toISOString() ?? null }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

interface ProductRow extends Omit<Product, "archived_at" | "variants"> {
  archived_at: Date | null;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.category_id,
         c.name             AS category_name,
         c.max_discount_pct AS category_max_discount_pct,
         p.base_price_cents, p.cost_cents, p.unit, p.tax_pct, p.description,
         p.is_subscription, p.recurring_interval, p.qty_on_hand, p.is_promoted,
         p.archived_at
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
`;

function toProduct(row: ProductRow, variants: ProductVariant[]): Product {
  return { ...row, archived_at: row.archived_at?.toISOString() ?? null, variants };
}

export interface ProductFilter {
  /** Screen 16 shows active by default and archived on request (A2.4). */
  include_archived?: boolean;
  category_id?: Id;
  /** Free-text over name and description. */
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Variants are fetched in ONE query for the whole page rather than per product.
 * Screen 16 lists 128 products; a per-row variant query is 128 round trips for
 * a table that renders in one.
 */
export async function listProducts(
  filter: ProductFilter,
  client?: Queryable,
): Promise<{ items: Product[]; total: number }> {
  const rows = await query<ProductRow & { total: number }>(
    `${PRODUCT_SELECT}
      WHERE ($1::boolean OR p.archived_at IS NULL)
        AND ($2::bigint IS NULL OR p.category_id = $2)
        AND ($3::text IS NULL OR p.name ILIKE '%' || $3 || '%'
                              OR p.description ILIKE '%' || $3 || '%')
      ORDER BY p.name
      LIMIT $4 OFFSET $5`,
    [
      filter.include_archived ?? false,
      filter.category_id ?? null,
      filter.q ?? null,
      filter.limit,
      filter.offset,
    ],
    client,
  );

  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM products p
      WHERE ($1::boolean OR p.archived_at IS NULL)
        AND ($2::bigint IS NULL OR p.category_id = $2)
        AND ($3::text IS NULL OR p.name ILIKE '%' || $3 || '%'
                              OR p.description ILIKE '%' || $3 || '%')`,
    [filter.include_archived ?? false, filter.category_id ?? null, filter.q ?? null],
    client,
  );

  const ids = rows.map((r) => r.id);
  const variants = ids.length > 0 ? await listVariantsFor(ids, client) : [];
  const byProduct = new Map<Id, ProductVariant[]>();
  for (const variant of variants) {
    const list = byProduct.get(variant.product_id) ?? [];
    list.push(variant);
    byProduct.set(variant.product_id, list);
  }

  return {
    items: rows.map((row) => toProduct(row, byProduct.get(row.id) ?? [])),
    total: totalRow?.total ?? 0,
  };
}

export async function findProduct(id: Id, client?: Queryable): Promise<Product | null> {
  const row = await queryOne<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id], client);
  if (row === null) return null;
  return toProduct(row, await listVariantsFor([id], client));
}

export async function insertProduct(
  input: {
    name: string;
    category_id: Id;
    base_price_cents: Cents;
    cost_cents: Cents;
    unit: string;
    tax_pct: Percent;
    description: string | null;
    is_subscription: boolean;
    recurring_interval: RecurringInterval | null;
    qty_on_hand: number;
    is_promoted: boolean;
  },
  client?: Queryable,
): Promise<Product> {
  const row = await queryOne<{ id: Id }>(
    `INSERT INTO products
       (name, category_id, base_price_cents, cost_cents, unit, tax_pct, description,
        is_subscription, recurring_interval, qty_on_hand, is_promoted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.name,
      input.category_id,
      input.base_price_cents,
      input.cost_cents,
      input.unit,
      input.tax_pct,
      input.description,
      input.is_subscription,
      input.recurring_interval,
      input.qty_on_hand,
      input.is_promoted,
    ],
    client,
  );
  if (row === null) throw new Error("INSERT INTO products returned no id");
  const created = await findProduct(row.id, client);
  if (created === null) throw new Error("Newly created product could not be read back");
  return created;
}

export async function updateProduct(
  id: Id,
  input: Partial<{
    name: string;
    category_id: Id;
    base_price_cents: Cents;
    cost_cents: Cents;
    unit: string;
    tax_pct: Percent;
    description: string | null;
    is_subscription: boolean;
    recurring_interval: RecurringInterval | null;
    qty_on_hand: number;
    is_promoted: boolean;
  }>,
  client?: Queryable,
): Promise<Product | null> {
  const updated = await queryOne<{ id: Id }>(
    `UPDATE products
        SET name               = COALESCE($2, name),
            category_id        = COALESCE($3, category_id),
            base_price_cents   = COALESCE($4, base_price_cents),
            cost_cents         = COALESCE($5, cost_cents),
            unit               = COALESCE($6, unit),
            tax_pct            = COALESCE($7, tax_pct),
            description        = COALESCE($8, description),
            is_subscription    = COALESCE($9, is_subscription),
            -- Not COALESCEd: clearing the interval is a legitimate edit when a
            -- product stops being a subscription, and COALESCE cannot express
            -- "set to null". The service decides; this honours it.
            recurring_interval = $10,
            qty_on_hand        = COALESCE($11, qty_on_hand),
            is_promoted        = COALESCE($12, is_promoted)
      WHERE id = $1
      RETURNING id`,
    [
      id,
      input.name ?? null,
      input.category_id ?? null,
      input.base_price_cents ?? null,
      input.cost_cents ?? null,
      input.unit ?? null,
      input.tax_pct ?? null,
      input.description ?? null,
      input.is_subscription ?? null,
      input.recurring_interval ?? null,
      input.qty_on_hand ?? null,
      input.is_promoted ?? null,
    ],
    client,
  );
  return updated === null ? null : findProduct(id, client);
}

/**
 * A2.4 — archive and restore. Never a DELETE: historical quotation lines
 * reference the product, and screen 16 reports "128 active, 6 archived".
 */
export function setProductArchived(
  id: Id,
  archived: boolean,
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    `UPDATE products
        SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE id = $1
      RETURNING id`,
    [id, archived],
    client,
  );
}

/** Screen 16's header counts, in one query rather than two list calls. */
export function productCounts(
  client?: Queryable,
): Promise<{ active: number; archived: number } | null> {
  return queryOne<{ active: number; archived: number }>(
    `SELECT count(*) FILTER (WHERE archived_at IS NULL)::int     AS active,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived
       FROM products`,
    [],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variants
// ─────────────────────────────────────────────────────────────────────────────

function listVariantsFor(productIds: Id[], client?: Queryable): Promise<ProductVariant[]> {
  return query<ProductVariant>(
    `SELECT id, product_id, attribute, values, extra_price_cents
       FROM product_variants
      WHERE product_id = ANY($1)
      ORDER BY id`,
    [productIds],
    client,
  );
}

export function insertVariant(
  productId: Id,
  input: { attribute: string; values: string; extra_price_cents: Cents },
  client?: Queryable,
): Promise<ProductVariant | null> {
  return queryOne<ProductVariant>(
    `INSERT INTO product_variants (product_id, attribute, values, extra_price_cents)
     VALUES ($1, $2, $3, $4)
     RETURNING id, product_id, attribute, values, extra_price_cents`,
    [productId, input.attribute, input.values, input.extra_price_cents],
    client,
  );
}

/** Scoped by product_id as well as id, so a mismatched pair is a 404, not a
 *  cross-product delete. */
export function deleteVariant(
  productId: Id,
  variantId: Id,
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    "DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING id",
    [variantId, productId],
    client,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Price lists
// ─────────────────────────────────────────────────────────────────────────────

interface PriceListRow extends Omit<PriceList, "archived_at"> {
  archived_at: Date | null;
}

const PRICE_LIST_SELECT = `
  SELECT pl.id, pl.name, pl.tier_id, t.name AS tier_name, pl.currency,
         pl.rule_type, pl.rule_value, pl.archived_at
    FROM price_lists pl
    LEFT JOIN customer_tiers t ON t.id = pl.tier_id
`;

const toPriceList = (row: PriceListRow): PriceList => ({
  ...row,
  archived_at: row.archived_at?.toISOString() ?? null,
});

export async function listPriceLists(
  includeArchived: boolean,
  client?: Queryable,
): Promise<PriceList[]> {
  const rows = await query<PriceListRow>(
    `${PRICE_LIST_SELECT}
      WHERE ($1::boolean OR pl.archived_at IS NULL)
      ORDER BY pl.name`,
    [includeArchived],
    client,
  );
  return rows.map(toPriceList);
}

export async function findPriceList(id: Id, client?: Queryable): Promise<PriceList | null> {
  const row = await queryOne<PriceListRow>(`${PRICE_LIST_SELECT} WHERE pl.id = $1`, [id], client);
  return row === null ? null : toPriceList(row);
}

export async function insertPriceList(
  input: {
    name: string;
    tier_id: Id | null;
    currency: CurrencyCode;
    rule_type: PriceRuleType;
    rule_value: number;
  },
  client?: Queryable,
): Promise<PriceList> {
  const row = await queryOne<{ id: Id }>(
    `INSERT INTO price_lists (name, tier_id, currency, rule_type, rule_value)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.name, input.tier_id, input.currency, input.rule_type, input.rule_value],
    client,
  );
  if (row === null) throw new Error("INSERT INTO price_lists returned no id");
  const created = await findPriceList(row.id, client);
  if (created === null) throw new Error("Newly created price list could not be read back");
  return created;
}

export async function updatePriceList(
  id: Id,
  input: Partial<{
    name: string;
    tier_id: Id | null;
    currency: CurrencyCode;
    rule_type: PriceRuleType;
    rule_value: number;
  }>,
  client?: Queryable,
): Promise<PriceList | null> {
  const updated = await queryOne<{ id: Id }>(
    `UPDATE price_lists
        SET name       = COALESCE($2, name),
            tier_id    = $3,
            currency   = COALESCE($4, currency),
            rule_type  = COALESCE($5, rule_type),
            rule_value = COALESCE($6, rule_value)
      WHERE id = $1
      RETURNING id`,
    [
      id,
      input.name ?? null,
      input.tier_id ?? null,
      input.currency ?? null,
      input.rule_type ?? null,
      input.rule_value ?? null,
    ],
    client,
  );
  return updated === null ? null : findPriceList(id, client);
}

export function setPriceListArchived(
  id: Id,
  archived: boolean,
  client?: Queryable,
): Promise<{ id: Id } | null> {
  return queryOne<{ id: Id }>(
    `UPDATE price_lists
        SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE id = $1
      RETURNING id`,
    [id, archived],
    client,
  );
}

export function listPriceListItems(
  priceListId: Id,
  client?: Queryable,
): Promise<{ product_id: Id; product_name: string; price_cents: Cents }[]> {
  return query(
    `SELECT pli.product_id, p.name AS product_name, pli.price_cents
       FROM price_list_items pli
       JOIN products p ON p.id = pli.product_id
      WHERE pli.price_list_id = $1
      ORDER BY p.name`,
    [priceListId],
    client,
  );
}

/** UPSERT, so setting an override twice is not an error the UI has to handle. */
export function upsertPriceListItem(
  priceListId: Id,
  input: { product_id: Id; price_cents: Cents },
  client?: Queryable,
): Promise<{ product_id: Id; price_cents: Cents } | null> {
  return queryOne(
    `INSERT INTO price_list_items (price_list_id, product_id, price_cents)
     VALUES ($1, $2, $3)
     ON CONFLICT (price_list_id, product_id)
       DO UPDATE SET price_cents = EXCLUDED.price_cents
     RETURNING product_id, price_cents`,
    [priceListId, input.product_id, input.price_cents],
    client,
  );
}

export function deletePriceListItem(
  priceListId: Id,
  productId: Id,
  client?: Queryable,
): Promise<{ product_id: Id } | null> {
  return queryOne(
    `DELETE FROM price_list_items
      WHERE price_list_id = $1 AND product_id = $2
      RETURNING product_id`,
    [priceListId, productId],
    client,
  );
}
