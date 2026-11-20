BEGIN;
SELECT pg_advisory_xact_lock(18315, 11);

CREATE TABLE IF NOT EXISTS customer_password_resets (
  account_id uuid PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
  window_started_at timestamptz NOT NULL CHECK (window_started_at <= requested_at),
  sent_count smallint NOT NULL CHECK (sent_count BETWEEN 1 AND 3),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz CHECK (consumed_at >= requested_at)
);

COMMIT;
