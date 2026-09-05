-- 003_catalogue.sql — products, variants and price lists. DB_SCHEMA.md §3.

-- Category ceilings (A3.2). Rows, like tier ceilings, for the same reason.
CREATE TABLE product_categories (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    max_discount_pct NUMERIC(6, 3) NOT NULL CHECK (max_discount_pct BETWEEN 0 AND 100)
);

CREATE TABLE products (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name               TEXT   NOT NULL,
    category_id        BIGINT NOT NULL REFERENCES product_categories (id) ON DELETE RESTRICT,
    base_price_cents   BIGINT NOT NULL CHECK (base_price_cents >= 0),
    -- Without cost there is no margin, and B3.4, B5.2 and A6.3 are all
    -- unimplementable. Cheap now, expensive at hour nine.
    cost_cents         BIGINT NOT NULL CHECK (cost_cents >= 0),
    unit               TEXT   NOT NULL,
    tax_pct            NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (tax_pct BETWEEN 0 AND 100),
    description        TEXT,
    is_subscription    BOOLEAN NOT NULL DEFAULT false,
    recurring_interval TEXT CHECK (recurring_interval IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    qty_on_hand        INT     NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
    is_promoted        BOOLEAN NOT NULL DEFAULT false,
    archived_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A subscription product with no interval is unbillable, so the database
    -- refuses it rather than trusting every write path to remember.
    CONSTRAINT products_subscription_needs_interval
        CHECK (NOT is_subscription OR recurring_interval IS NOT NULL)
);

CREATE INDEX products_category_id_idx ON products (category_id);
-- Screen 16 lists active products and counts archived ones separately.
CREATE INDEX products_active_idx ON products (id) WHERE archived_at IS NULL;

-- Flat attribute list, exactly as screen 17 draws it — not a combination
-- matrix. A deliberate simplification, recorded in TRD.md §10.
CREATE TABLE product_variants (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id        BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    attribute         TEXT   NOT NULL,
    values            TEXT   NOT NULL,
    extra_price_cents BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX product_variants_product_id_idx ON product_variants (product_id);

-- A2.3 / A2.5. "Price minus 10 percent base" is rule_type='percent_off',
-- rule_value=10 — a formula stored as data, not a special-cased price column.
CREATE TABLE price_lists (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT    NOT NULL,
    tier_id     BIGINT  REFERENCES customer_tiers (id) ON DELETE SET NULL,
    currency    CHAR(3) NOT NULL DEFAULT 'USD',
    rule_type   TEXT    NOT NULL CHECK (rule_type IN ('none', 'percent_off', 'fixed')),
    rule_value  NUMERIC(10, 3) NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ
);

-- Per-product override; wins over the price list's own rule. Step one of the
-- three-step resolution order implemented in services/pricing.ts.
CREATE TABLE price_list_items (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    price_list_id BIGINT NOT NULL REFERENCES price_lists (id) ON DELETE CASCADE,
    product_id    BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    price_cents   BIGINT NOT NULL CHECK (price_cents >= 0),
    UNIQUE (price_list_id, product_id)
);
