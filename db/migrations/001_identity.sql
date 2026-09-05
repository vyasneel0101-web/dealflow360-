-- 001_identity.sql — internal identity and the internal session realm.
--
-- DB_SCHEMA.md §2. The load-bearing decision in this file is what is NOT here:
-- customers and their sessions live in 002, in their own tables. A portal
-- identity has no representation the internal system can express, so portal
-- isolation is structural rather than a WHERE clause somebody has to remember.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE sales_teams (
    id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
);

-- Internal users only. Never customers — see the design note in DB_SCHEMA.md §2.
CREATE TABLE users (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- CITEXT so Bob@x.com and bob@x.com cannot become two accounts.
    email          CITEXT NOT NULL UNIQUE,
    password_hash  TEXT   NOT NULL,
    full_name      TEXT   NOT NULL,
    role           TEXT   NOT NULL
                   CHECK (role IN ('rep', 'manager', 'finance', 'admin')),
    sales_team_id  BIGINT REFERENCES sales_teams (id) ON DELETE SET NULL,
    is_active      BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A7.3 filters reports by rep and by team.
CREATE INDEX users_sales_team_id_idx ON users (sales_team_id);

-- The internal session realm. `sessions` and `portal_sessions` (002) are two
-- tables on purpose: requireInternal looks only here, requirePortal looks only
-- there, and there is no shared code path where a missing check could leak.
CREATE TABLE sessions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- SHA-256 of the bearer token. The token itself is never stored, so a
    -- database dump yields no usable credential.
    token_hash  TEXT   NOT NULL UNIQUE,
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent  TEXT
);

-- Every lookup is by token_hash with the liveness predicate; logout sets
-- revoked_at, which is what makes "kill this session now" actually true.
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_live_idx ON sessions (expires_at) WHERE revoked_at IS NULL;
