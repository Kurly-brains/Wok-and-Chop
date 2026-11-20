BEGIN;
SELECT pg_advisory_xact_lock(18315, 8);
LOCK TABLE delivery_orders IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM delivery_orders WHERE fulfillment = 'PICKUP') THEN
    RAISE EXCEPTION 'Pickup records exist. Preserve them before rolling back pickup fulfillment.';
  END IF;
END;
$$;

ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_fulfillment_status_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_status_check
  CHECK (status IN ('RECEIVED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
DROP INDEX IF EXISTS delivery_orders_pickups_waiting;
ALTER TABLE delivery_orders DROP COLUMN fulfillment;

CREATE OR REPLACE FUNCTION protect_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.order_number, OLD.request_hash, OLD.request_fingerprint, OLD.tracking_hash, OLD.snapshot, OLD.created_at)
     IS DISTINCT FROM ROW(NEW.id, NEW.order_number, NEW.request_hash, NEW.request_fingerprint, NEW.tracking_hash, NEW.snapshot, NEW.created_at) THEN
    RAISE EXCEPTION 'Delivery receipt snapshots and identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
