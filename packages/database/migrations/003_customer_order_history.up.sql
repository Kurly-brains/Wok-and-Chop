BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_account_id uuid
  REFERENCES customer_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_orders_by_date
  ON orders(customer_account_id, created_at DESC, id DESC)
  WHERE customer_account_id IS NOT NULL;
COMMIT;
