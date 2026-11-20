BEGIN;
SELECT pg_advisory_xact_lock(18315, 8);

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE delivery_orders DROP CONSTRAINT IF EXISTS delivery_orders_status_check;
ALTER TABLE delivery_orders DROP CONSTRAINT IF EXISTS delivery_orders_fulfillment_status_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_fulfillment_status_check CHECK (
  (fulfillment = 'DELIVERY' AND status IN ('RECEIVED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'))
  OR (fulfillment = 'PICKUP' AND status IN ('RECEIVED','PREPARING','READY_FOR_PICKUP','PICKED_UP','CANCELLED'))
);

CREATE INDEX IF NOT EXISTS delivery_orders_pickups_waiting ON delivery_orders(order_number DESC)
  WHERE fulfillment = 'PICKUP' AND status IN ('RECEIVED','PREPARING','READY_FOR_PICKUP');

CREATE OR REPLACE FUNCTION protect_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.order_number, OLD.request_hash, OLD.request_fingerprint, OLD.tracking_hash, OLD.snapshot, OLD.created_at, OLD.fulfillment)
     IS DISTINCT FROM ROW(NEW.id, NEW.order_number, NEW.request_hash, NEW.request_fingerprint, NEW.tracking_hash, NEW.snapshot, NEW.created_at, NEW.fulfillment) THEN
    RAISE EXCEPTION 'Order receipt snapshots and identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
