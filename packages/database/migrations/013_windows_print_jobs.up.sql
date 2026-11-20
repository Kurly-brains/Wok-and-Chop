BEGIN;
SELECT pg_advisory_xact_lock(18315,13);
CREATE TABLE IF NOT EXISTS windows_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('TEST','PICKUP_KITCHEN')),
  order_id uuid REFERENCES delivery_orders(id) ON DELETE RESTRICT,
  order_number text,
  queue_name text NOT NULL CHECK (length(queue_name) BETWEEN 1 AND 220),
  payload text NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 100000),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('SENDING','SPOOLED','FAILED','UNKNOWN')),
  detail text NOT NULL,
  actor_id uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='TEST' AND order_id IS NULL AND order_number IS NULL) OR
         (kind='PICKUP_KITCHEN' AND order_id IS NOT NULL AND order_number IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS windows_print_one_original ON windows_print_jobs(order_id) WHERE kind='PICKUP_KITCHEN';
CREATE UNIQUE INDEX IF NOT EXISTS windows_print_single_sender ON windows_print_jobs(queue_name) WHERE status='SENDING';
CREATE INDEX IF NOT EXISTS windows_print_recent ON windows_print_jobs(created_at DESC);
CREATE OR REPLACE FUNCTION protect_windows_print_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id,OLD.request_hash,OLD.request_fingerprint,OLD.kind,OLD.order_id,OLD.order_number,OLD.queue_name,OLD.payload,OLD.payload_hash,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.id,NEW.request_hash,NEW.request_fingerprint,NEW.kind,NEW.order_id,NEW.order_number,NEW.queue_name,NEW.payload,NEW.payload_hash,NEW.created_at) THEN
    RAISE EXCEPTION 'Windows print identity and payload are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='SENDING' AND NEW.status IN ('SPOOLED','FAILED','UNKNOWN')) THEN
    RAISE EXCEPTION 'Windows print jobs cannot be resent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS windows_print_intent_guard ON windows_print_jobs;
CREATE TRIGGER windows_print_intent_guard BEFORE UPDATE ON windows_print_jobs FOR EACH ROW EXECUTE FUNCTION protect_windows_print_intent();
COMMIT;
