-- Customer accounts are independent of the not-yet-connected ordering ledger.
BEGIN;
CREATE TABLE IF NOT EXISTS customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(email_normalized) AND length(email_normalized) <= 254),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS customer_session_expiry ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS customer_session_account ON customer_sessions(account_id);
COMMIT;
