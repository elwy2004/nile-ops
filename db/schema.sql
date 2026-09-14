-- Nile Ops — Stage 1 schema
-- Quotes move sales -> operations -> finance. Prices freeze when a client accepts.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('sales','ops','finance','admin')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- The price book. One row per sellable item; which rate columns are used
-- depends on the book (transfers carry three, hotels two, the rest one).
CREATE TABLE IF NOT EXISTS rate_items (
  id      SERIAL PRIMARY KEY,
  book    TEXT NOT NULL CHECK (book IN ('hotels','transfers','sights','meals','services')),
  name    TEXT NOT NULL,
  rate1   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- hotels: per night DBL (USD) | transfers: Hi-Ace 8 | others: per person (EGP)
  rate2   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- hotels: single supp (USD)   | transfers: Coaster 16
  rate3   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- transfers: Bus
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (book, name)
);

CREATE SEQUENCE IF NOT EXISTS quote_ref_seq START 1;

CREATE TABLE IF NOT EXISTS quotes (
  id           SERIAL PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  client_name  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','quoted','accepted','confirming','ready','invoiced','paid','closed','lost','cancelled')),
  pax          INTEGER NOT NULL DEFAULT 2 CHECK (pax > 0),
  arrival      DATE,
  departure    DATE,
  fx           NUMERIC(12,4) NOT NULL DEFAULT 50,      -- EGP per USD
  margin_pct   NUMERIC(6,2)  NOT NULL DEFAULT 10,
  flights_usd  NUMERIC(12,2) NOT NULL DEFAULT 0,
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Prices freeze here. NULL while the quote is still live against the price book.
  snapshot     JSONB,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_status_idx ON quotes(status);
CREATE INDEX IF NOT EXISTS quotes_owner_idx  ON quotes(owner_id);

CREATE TABLE IF NOT EXISTS quote_lines (
  id        SERIAL PRIMARY KEY,
  quote_id  INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  section   TEXT NOT NULL CHECK (section IN ('acc','sights','transfers','meals','services')),
  item_name TEXT NOT NULL DEFAULT '',
  qty       NUMERIC(10,2) NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quote_lines_quote_idx ON quote_lines(quote_id);

-- Every status change and edit that matters, kept forever.
CREATE TABLE IF NOT EXISTS quote_events (
  id          SERIAL PRIMARY KEY,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,          -- 'created' | 'status' | 'edited' | 'note'
  from_status TEXT,
  to_status   TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_events_quote_idx ON quote_events(quote_id, created_at DESC);
