/**
 * Catalogue business rules (A2.1–A2.6).
 *
 * The schema already refuses a subscription product with no interval and a
 * negative price. What lives here is what the schema cannot express: rules that
 * depend on another table, and rules that are policy rather than corruption.
 */
import * as repo from "../repositories/catalogue.ts";
import { businessRule, notFound } from "../lib/errors.ts";
import type {
  CreateCategoryRequest,
  CreatePriceListRequest,
  CreateProductRequest,
  CreateTierRequest,
  CreateVariantRequest,
  CustomerTier,
  Id,
  PriceList,
  Product,
  ProductCategory,
  ProductVariant,
  UpdateCategoryRequest,
  UpdatePriceListRequest,
  UpdateProductRequest,
  UpdateTierRequest,
  UpsertPriceListItemRequest,
} from "../../shared/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

export function listProducts(filter: repo.ProductFilter) {
  return repo.listProducts(filter);
}

export function productCounts() {
  return repo.productCounts();
}

export async function getProduct(id: Id): Promise<Product> {
  const product = await repo.findProduct(id);
  if (product === null) throw notFound("That product does not exist.");
  return product;
}

/**
 * A2.6 — the subscription/interval pairing. The database has a CHECK for this,
 * but a constraint violation surfaces as a 500 with a Postgres error string.
 * Checking here turns it into a 422 that names the field, which is what screen
 * 17's "Subscription: Yes" toggle needs to render an error against.
 */
function assertSubscriptionShape(input: {
  is_subscription?: boolean;
  recurring_interval?: string | null;
}): void {
  if (input.is_subscription === true && !input.recurring_interval) {
    throw businessRule("A subscription product needs a billing interval.");
  }
  if (input.is_subscription === false && input.recurring_interval) {
    throw businessRule("Only a subscription product can have a billing interval.");
  }
}

export async function createProduct(input: CreateProductRequest): Promise<Product> {
  assertSubscriptionShape(input);
  await assertCategoryExists(input.category_id);

  // Not a hard error: a loss-leader is a legitimate business decision, and
  // refusing it would block a real quote. But margin figures downstream will
  // read negative, so it is worth being deliberate about rather than silent.
  return repo.insertProduct({
    name: input.name,
    category_id: input.category_id,
    base_price_cents: input.base_price_cents,
    cost_cents: input.cost_cents,
    unit: input.unit,
    tax_pct: input.tax_pct ?? 0,
    description: input.description ?? null,
    is_subscription: input.is_subscription ?? false,
    recurring_interval: input.recurring_interval ?? null,
    qty_on_hand: input.qty_on_hand ?? 0,
    is_promoted: input.is_promoted ?? false,
  });
}

export async function updateProduct(id: Id, input: UpdateProductRequest): Promise<Product> {
  const existing = await getProduct(id);

  // The pairing rule applies to the RESULT of the edit, not to the fields sent.
  // Turning `is_subscription` on without sending an interval must fail even
  // though the interval field is absent from this particular request.
  assertSubscriptionShape({
    is_subscription: input.is_subscription ?? existing.is_subscription,
    recurring_interval:
      "recurring_interval" in input ? input.recurring_interval : existing.recurring_interval,
  });

  if (input.category_id !== undefined) await assertCategoryExists(input.category_id);

  const updated = await repo.updateProduct(id, {
    ...input,
    // Preserved explicitly because the repository does not COALESCE this column
    // — clearing it has to be expressible.
    recurring_interval:
      "recurring_interval" in input ? (input.recurring_interval ?? null) : existing.recurring_interval,
  });
  if (updated === null) throw notFound("That product does not exist.");
  return updated;
}

/** A2.4 — archive, never delete. Old quotation lines still reference it. */
export async function setProductArchived(id: Id, archived: boolean): Promise<Product> {
  const result = await repo.setProductArchived(id, archived);
  if (result === null) throw notFound("That product does not exist.");
  return getProduct(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Variants (A2.2)
// ─────────────────────────────────────────────────────────────────────────────

export async function addVariant(
  productId: Id,
  input: CreateVariantRequest,
): Promise<ProductVariant> {
  await getProduct(productId); // 404 for an unknown product, before the insert.
  const variant = await repo.insertVariant(productId, {
    attribute: input.attribute,
    values: input.values,
    extra_price_cents: input.extra_price_cents ?? 0,
  });
  if (variant === null) throw new Error("INSERT INTO product_variants returned no row");
  return variant;
}

export async function removeVariant(productId: Id, variantId: Id): Promise<void> {
  const deleted = await repo.deleteVariant(productId, variantId);
  // A variant belonging to a different product is a 404, not a 403 — the same
  // reason the API never distinguishes absent from not-yours (TRD.md §4).
  if (deleted === null) throw notFound("That variant does not exist.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories & tiers — the ceilings the risk engine reads
// ─────────────────────────────────────────────────────────────────────────────

export function listCustomers(includeArchived: boolean) {
  return repo.listCustomers(includeArchived);
}

export function listCategories(): Promise<ProductCategory[]> {
  return repo.listCategories();
}

async function assertCategoryExists(id: Id): Promise<void> {
  const categories = await repo.listCategories();
  if (!categories.some((c) => c.id === id)) {
    throw businessRule("That product category does not exist.");
  }
}

export async function createCategory(input: CreateCategoryRequest): Promise<ProductCategory> {
  const created = await repo.insertCategory(input);
  if (created === null) throw new Error("INSERT INTO product_categories returned no row");
  return created;
}

export async function updateCategory(
  id: Id,
  input: UpdateCategoryRequest,
): Promise<ProductCategory> {
  const updated = await repo.updateCategory(id, input);
  if (updated === null) throw notFound("That category does not exist.");
  return updated;
}

export function listTiers(): Promise<CustomerTier[]> {
  return repo.listTiers();
}

export async function createTier(input: CreateTierRequest): Promise<CustomerTier> {
  const created = await repo.insertTier({ ...input, sort_order: input.sort_order ?? 0 });
  if (created === null) throw new Error("INSERT INTO customer_tiers returned no row");
  return created;
}

export async function updateTier(id: Id, input: UpdateTierRequest): Promise<CustomerTier> {
  const updated = await repo.updateTier(id, input);
  if (updated === null) throw notFound("That tier does not exist.");
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Price lists (A2.3, A2.5)
// ─────────────────────────────────────────────────────────────────────────────

export function listPriceLists(includeArchived: boolean): Promise<PriceList[]> {
  return repo.listPriceLists(includeArchived);
}

export async function getPriceList(id: Id): Promise<PriceList> {
  const list = await repo.findPriceList(id);
  if (list === null) throw notFound("That price list does not exist.");
  return list;
}

/**
 * A2.5 — the rule is a formula, and the formula has to make sense. `none`
 * carries no value; `percent_off` is a percentage and cannot exceed 100, or the
 * list would price everything at zero and quietly destroy margin on every quote
 * that used it.
 */
function assertRuleShape(ruleType: string | undefined, ruleValue: number | undefined): void {
  if (ruleType === "percent_off" && (ruleValue === undefined || ruleValue < 0 || ruleValue > 100)) {
    throw businessRule("A percent-off rule needs a value between 0 and 100.");
  }
  if (ruleType === "fixed" && (ruleValue === undefined || ruleValue < 0)) {
    throw businessRule("A fixed-price rule needs a value of 0 or more.");
  }
}

export async function createPriceList(input: CreatePriceListRequest): Promise<PriceList> {
  assertRuleShape(input.rule_type, input.rule_value);
  return repo.insertPriceList({
    name: input.name,
    tier_id: input.tier_id ?? null,
    currency: input.currency ?? "USD",
    rule_type: input.rule_type,
    rule_value: input.rule_value ?? 0,
  });
}

export async function updatePriceList(
  id: Id,
  input: UpdatePriceListRequest,
): Promise<PriceList> {
  const existing = await getPriceList(id);
  // Validated against the resulting rule, for the same reason the subscription
  // pairing is: changing rule_type alone must not leave an incoherent list.
  assertRuleShape(
    input.rule_type ?? existing.rule_type,
    input.rule_value ?? existing.rule_value,
  );
  const updated = await repo.updatePriceList(id, input);
  if (updated === null) throw notFound("That price list does not exist.");
  return updated;
}

export async function setPriceListArchived(id: Id, archived: boolean): Promise<PriceList> {
  const result = await repo.setPriceListArchived(id, archived);
  if (result === null) throw notFound("That price list does not exist.");
  return getPriceList(id);
}

export async function listPriceListItems(priceListId: Id) {
  await getPriceList(priceListId);
  return repo.listPriceListItems(priceListId);
}

export async function upsertPriceListItem(
  priceListId: Id,
  input: UpsertPriceListItemRequest,
) {
  await getPriceList(priceListId);
  await getProduct(input.product_id);
  const item = await repo.upsertPriceListItem(priceListId, input);
  if (item === null) throw new Error("Upserting a price list item returned no row");
  return item;
}

export async function removePriceListItem(priceListId: Id, productId: Id): Promise<void> {
  const deleted = await repo.deletePriceListItem(priceListId, productId);
  if (deleted === null) throw notFound("That price list override does not exist.");
}
