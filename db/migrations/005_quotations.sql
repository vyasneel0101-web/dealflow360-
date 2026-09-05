-- 005_quotations.sql — quotations, lines, the configurable routing table, and
-- the append-only audit log. DB_SCHEMA.md §5–6.

CREATE TABLE quotations (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ref                     TEXT   NOT NULL UNIQUE,
    customer_id             BIGINT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    price_list_id           BIGINT REFERENCES price_lists (id) ON DELETE SET NULL,
    owner_user_id           BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status                  TEXT   NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'pending_approval', 'returned',
                                              'approved', 'negotiation', 'confirmed', 'rejected')),
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    requested_delivery_date DATE,
    promised_date           DATE,

    -- Caches of a pure function of the lines, written on every line mutation.
    -- Cached because screens 3 and 5 list many quotations and must not
    -- recompute per row; safe because one service function owns every write
    -- path (TRD.md §5.1).
    blended_score           NUMERIC(8, 3),
    worst_line_overage      NUMERIC(8, 3),
    risk_band               TEXT CHECK (risk_band IN ('low', 'medium', 'high')),

    negotiation_round       INT NOT NULL DEFAULT 0,
    -- Drives B9.1 stalled detection.
    last_activity_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at            TIMESTAMPTZ
);

CREATE INDEX quotations_status_idx        ON quotations (status);
CREATE INDEX quotations_owner_idx         ON quotations (owner_user_id);
CREATE INDEX quotations_customer_idx      ON quotations (customer_id);
CREATE INDEX quotations_last_activity_idx ON quotations (last_activity_at);

CREATE TABLE quotation_lines (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quotation_id       BIGINT NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
    product_id         BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    variant_id         BIGINT REFERENCES product_variants (id) ON DELETE SET NULL,
    qty                INT    NOT NULL CHECK (qty > 0),

    -- Snapshotted at add time. If the line joined to products for price, an
    -- admin editing a price would silently rewrite the value of every
    -- historical quotation including approved ones — making the audit trail a
    -- false record rather than a true one (DB_SCHEMA.md §5).
    unit_price_cents   BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    unit_cost_cents    BIGINT NOT NULL CHECK (unit_cost_cents >= 0),

    discount_pct       NUMERIC(6, 3) NOT NULL DEFAULT 0
                       CHECK (discount_pct BETWEEN 0 AND 100),
    line_type          TEXT NOT NULL DEFAULT 'one_time'
                       CHECK (line_type IN ('one_time', 'recurring')),
    recurring_interval TEXT CHECK (recurring_interval IN ('weekly', 'monthly', 'quarterly', 'yearly')),

    -- Persisted, not recomputed on read, so screen 4's Limit/Status columns and
    -- screen 6's "Why This Quote Was Flagged" render from the same stored facts
    -- that actually routed the deal.
    ceiling_pct        NUMERIC(6, 3) NOT NULL DEFAULT 0,
    overage_pct        NUMERIC(6, 3) NOT NULL DEFAULT 0,
    sort_order         INT NOT NULL DEFAULT 0
);

CREATE INDEX quotation_lines_quotation_idx ON quotation_lines (quotation_id);

-- Full serialisation at the close of each negotiation round, so B8.6
-- re-approval can show what changed and the audit trail refers to real
-- historical terms. UNIQUE stops a double-submit creating two round 3s.
CREATE TABLE quotation_snapshots (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quotation_id BIGINT NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
    round        INT    NOT NULL,
    payload      JSONB  NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (quotation_id, round)
);

-- The portal session's scope FK, deferred from 002 until quotations existed.
ALTER TABLE portal_sessions
    ADD CONSTRAINT portal_sessions_quotation_fk
    FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The configurable routing table (A3.3, wireframe screen 18)
--
-- All four thresholds are ROWS. This is the concrete answer to PS §7's "not
-- hardcoded or faked for the demo": screen 18's Save writes here, and the next
-- quotation routes differently.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE approval_chain_rules (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    band              TEXT   NOT NULL UNIQUE CHECK (band IN ('low', 'medium', 'high')),
    min_blended_score NUMERIC(8, 3) NOT NULL,
    min_worst_line    NUMERIC(8, 3) NOT NULL,
    required_levels   TEXT[] NOT NULL
);

-- Seeded here rather than in seed.ts: without these rows the risk engine has no
-- routing table at all and every quotation fails closed to `high`. They are
-- configuration the application requires to function, not demo data.
INSERT INTO approval_chain_rules (band, min_blended_score, min_worst_line, required_levels) VALUES
    ('low',    0,  0, '{}'),
    ('medium', 2,  5, '{manager}'),
    ('high',   5, 10, '{manager,finance}');

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log — append-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type      TEXT   NOT NULL,
    entity_id        BIGINT NOT NULL,
    -- Distinguishes a customer's portal action from a rep's, which is what
    -- makes screen 6's trail trustworthy.
    actor_kind       TEXT   NOT NULL CHECK (actor_kind IN ('internal', 'portal', 'system')),
    actor_user_id    BIGINT REFERENCES users (id) ON DELETE SET NULL,
    actor_contact_id BIGINT REFERENCES contacts (id) ON DELETE SET NULL,
    action           TEXT   NOT NULL,
    note             TEXT,
    before           JSONB,
    after            JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
-- Screen 2's Recent Activity feed is a SELECT … ORDER BY created_at DESC LIMIT 10.
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC);
