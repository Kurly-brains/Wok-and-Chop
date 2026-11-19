BEGIN;
CREATE TABLE IF NOT EXISTS restaurant_managers (
  account_id uuid PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
