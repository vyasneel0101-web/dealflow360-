-- 002_customers.sql — customers, their people, and the portal session realm.
-- DB_SCHEMA.md §2–3.

-- Tier ceilings are ROWS, not constants. PS §7 requires the rules be
-- configurable rather than hardcoded, so screen 18 writes here.
CREATE TABLE customer_tiers (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    max_discount_pct NUMERIC(6, 3) NOT NULL CHECK (max_discount_pct BETWEEN 0 AND 100),
    sort_order       INT  NOT NULL DEFAULT 0
);

CREATE TABLE customers (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT   NOT NULL,
    tier_id     BIGINT NOT NULL REFERENCES customer_tiers (id) ON DELETE RESTRICT,
    email       CITEXT,
    currency    CHAR(3) NOT NULL DEFAULT 'USD',
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customers_tier_id_idx ON customers (tier_id);

-- Customer-side people. Deliberately NOT rows in `users`.
CREATE TABLE contacts (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id   BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    email         CITEXT NOT NULL UNIQUE,
    full_name     TEXT   NOT NULL,
    -- NULL is legitimate: a magic-link contact never sets a password (A1.2).
    password_hash TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX contacts_customer_id_idx ON contacts (customer_id);

-- The portal session realm. Same shape as `sessions`, different namespace —
-- that separation is the whole of PS §7's "real, separate, restricted view".
CREATE TABLE portal_sessions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash  TEXT   NOT NULL UNIQUE,
    contact_id  BIGINT NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
    -- A portal session is scoped to the one quotation it was minted for. The
    -- FK arrives with the quotations table in a later migration; until then a
    -- portal session cannot be minted anyway, because there is nothing to scope
    -- it to.
    quotation_id BIGINT,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent  TEXT
);

CREATE INDEX portal_sessions_contact_id_idx ON portal_sessions (contact_id);
CREATE INDEX portal_sessions_live_idx ON portal_sessions (expires_at) WHERE revoked_at IS NULL;
