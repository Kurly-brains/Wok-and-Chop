BEGIN;
SELECT pg_advisory_xact_lock(18315,15);
-- Current receipt/status stays intact. Reversing removes staff-only metadata and richer audit detail.
DROP INDEX IF EXISTS delivery_orders_archived;
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS manager_note;
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS archived_at;
ALTER TABLE delivery_orders DROP COLUMN IF EXISTS created_by_manager_id;
ALTER TABLE delivery_order_events DROP COLUMN IF EXISTS action;
ALTER TABLE delivery_order_events DROP COLUMN IF EXISTS previous_status;
ALTER TABLE delivery_order_events DROP COLUMN IF EXISTS reason;
ALTER TABLE delivery_order_events DROP COLUMN IF EXISTS detail;
COMMIT;
