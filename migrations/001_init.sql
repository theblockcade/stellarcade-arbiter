-- Round commitments. server_seed is only readable by the arbiter itself —
-- it must never be exposed via any API before the round settles.
CREATE TABLE IF NOT EXISTS commitments (
  round_id            TEXT PRIMARY KEY,
  game_id             TEXT NOT NULL,
  server_seed         TEXT NOT NULL,
  commit_hash         TEXT NOT NULL,
  committed_at_ledger BIGINT NOT NULL,
  expires_at_ledger   BIGINT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('committed', 'revealed', 'settled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE on round_id (via PRIMARY KEY) is what makes concurrent settlement
-- safe: two settlement attempts race on this INSERT, only one wins.
CREATE TABLE IF NOT EXISTS settlements (
  round_id          TEXT PRIMARY KEY REFERENCES commitments(round_id),
  client_seed       TEXT NOT NULL,
  nonce             BIGINT NOT NULL,
  ledger_hash       TEXT NOT NULL,
  derived_value     TEXT NOT NULL,
  outcome           JSONB NOT NULL,
  payout            TEXT NOT NULL,
  settled_at_ledger BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, hash-chained audit log. Each row's hash covers the previous
-- row's hash, so any historical edit breaks the chain from that point
-- forward — see docs/decisions.md for the tamper-evidence rationale.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  data       JSONB NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_game_id ON commitments(game_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
