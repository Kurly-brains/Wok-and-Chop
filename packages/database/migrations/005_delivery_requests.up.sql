BEGIN;
SELECT pg_advisory_xact_lock(18315, 5);
CREATE TABLE IF NOT EXISTS delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  customer_account_id uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  tracking_hash text NOT NULL UNIQUE CHECK (tracking_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_orders_owner ON delivery_orders(customer_account_id, order_number DESC)
  WHERE customer_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_orders_waiting ON delivery_orders(order_number DESC)
  WHERE status IN ('RECEIVED','PREPARING','OUT_FOR_DELIVERY');
CREATE TABLE IF NOT EXISTS delivery_order_events (
  order_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL,
  manager_id uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id,version)
);
CREATE OR REPLACE FUNCTION protect_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id, OLD.order_number, OLD.request_hash, OLD.request_fingerprint, OLD.tracking_hash, OLD.snapshot, OLD.created_at)
     IS DISTINCT FROM ROW(NEW.id, NEW.order_number, NEW.request_hash, NEW.request_fingerprint, NEW.tracking_hash, NEW.snapshot, NEW.created_at) THEN
    RAISE EXCEPTION 'Delivery receipt snapshots and identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER immutable_delivery_receipt BEFORE UPDATE ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION protect_delivery_snapshot();
COMMIT;
