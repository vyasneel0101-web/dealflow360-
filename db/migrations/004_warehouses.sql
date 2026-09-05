-- 004_warehouses.sql — warehouses, stock and replenishment. DB_SCHEMA.md §4.

CREATE TABLE warehouses (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                 TEXT NOT NULL UNIQUE,
    -- The A4.3 input to split optimisation: the greedy split prefers the
    -- warehouse that can fill a line whole at the lowest weight.
    shipping_cost_weight NUMERIC(10, 3) NOT NULL DEFAULT 1.0 CHECK (shipping_cost_weight > 0),
    is_active            BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE stock (
    warehouse_id BIGINT NOT NULL REFERENCES warehouses (id) ON DELETE CASCADE,
    product_id   BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    on_hand      INT    NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
    reserved     INT    NOT NULL DEFAULT 0 CHECK (reserved >= 0),

    PRIMARY KEY (warehouse_id, product_id),

    -- The oversell guard, at the database level. Reservation runs inside a
    -- transaction with SELECT … FOR UPDATE in a deterministic lock order, but
    -- if that logic is ever wrong, Postgres still refuses the write.
    --
    -- `available` (on_hand - reserved) is deliberately NOT a column. A third
    -- number that can disagree with the other two is a bug class we decline to
    -- have; it is computed on read instead.
    CONSTRAINT stock_no_oversell CHECK (reserved <= on_hand)
);

CREATE INDEX stock_product_id_idx ON stock (product_id);

CREATE TABLE replenishment_rules (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses (id) ON DELETE CASCADE,
    product_id   BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    min_qty      INT    NOT NULL CHECK (min_qty >= 0),
    reorder_qty  INT    NOT NULL CHECK (reorder_qty > 0),
    UNIQUE (warehouse_id, product_id)
);
