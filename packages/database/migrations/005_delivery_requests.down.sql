BEGIN;
SELECT pg_advisory_xact_lock(18315, 5);
DROP TABLE IF EXISTS delivery_order_events;
DROP TABLE IF EXISTS delivery_orders;
DROP FUNCTION IF EXISTS protect_delivery_snapshot();
COMMIT;
