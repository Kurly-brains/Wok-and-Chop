BEGIN;
DROP INDEX IF EXISTS customer_orders_by_date;
ALTER TABLE orders DROP COLUMN IF EXISTS customer_account_id;
COMMIT;
