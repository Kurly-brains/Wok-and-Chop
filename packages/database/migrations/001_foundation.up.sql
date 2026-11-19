-- Development schema foundation; application transaction protocols are not implemented.
BEGIN;

CREATE TYPE payment_state AS ENUM ('UNPAID','PROCESSING','PAID','PARTIALLY_REFUNDED','REFUNDED','FAILED');
CREATE TYPE fulfillment_state AS ENUM ('AWAITING_PAYMENT','ACCEPTED','SCHEDULED','IN_PREPARATION','READY','COMPLETED','CANCELLED','EXCEPTION');
CREATE TYPE attempt_state AS ENUM ('CREATING','OPEN','PROCESSING','SUCCEEDED','FAILED','EXPIRED');
CREATE TYPE refund_state AS ENUM ('PENDING','SUCCEEDED','FAILED');
CREATE TYPE print_state AS ENUM ('QUEUED','LEASED','SENDING','DELIVERED','CONFIRMED','RETRY_WAIT','UNKNOWN','FAILED','CANCELLED');

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Toronto' CHECK (timezone = 'America/Toronto'),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  accepting_orders boolean NOT NULL DEFAULT false,
  configuration_version integer NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  business_date date NOT NULL,
  display_number bigint NOT NULL CHECK (display_number > 0),
  payment_status payment_state NOT NULL DEFAULT 'UNPAID',
  fulfillment_status fulfillment_state NOT NULL DEFAULT 'AWAITING_PAYMENT',
  canonical_payment_id uuid,
  active_revision integer NOT NULL DEFAULT 1 CHECK (active_revision > 0),
  fulfillment_type text NOT NULL DEFAULT 'PICKUP' CHECK (fulfillment_type = 'PICKUP'),
  requested_local_time text,
  timezone text NOT NULL DEFAULT 'America/Toronto' CHECK (timezone = 'America/Toronto'),
  pickup_at timestamptz,
  prep_release_at timestamptz,
  pay_by_at timestamptz,
  guest_token_hash text,
  guest_token_expires_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, business_date, display_number),
  UNIQUE (id, location_id),
  CHECK (prep_release_at IS NULL OR pickup_at IS NULL OR prep_release_at <= pickup_at)
);

CREATE TABLE order_revisions (
  order_id uuid NOT NULL REFERENCES orders(id),
  revision integer NOT NULL CHECK (revision > 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  tax_snapshot jsonb NOT NULL CHECK (jsonb_typeof(tax_snapshot) = 'object'),
  pricing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
  menu_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, revision)
);
ALTER TABLE orders ADD CONSTRAINT orders_active_revision_fk FOREIGN KEY (id, active_revision)
  REFERENCES order_revisions(order_id, revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  revision integer NOT NULL,
  status attempt_state NOT NULL DEFAULT 'CREATING',
  expected_amount_cents bigint NOT NULL CHECK (expected_amount_cents > 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  provider_session_id text UNIQUE,
  provider_payment_intent_id text UNIQUE,
  provider_idempotency_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  expires_at timestamptz NOT NULL,
  reconciled_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, order_id),
  FOREIGN KEY (order_id, revision) REFERENCES order_revisions(order_id, revision)
);
CREATE UNIQUE INDEX one_active_attempt_per_order ON payment_attempts(order_id)
  WHERE status IN ('CREATING','OPEN','PROCESSING');

CREATE TABLE captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  attempt_id uuid NOT NULL,
  provider_payment_id text NOT NULL UNIQUE,
  provider_account_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','live')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  is_canonical boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, order_id),
  FOREIGN KEY (attempt_id, order_id) REFERENCES payment_attempts(id, order_id)
);
CREATE UNIQUE INDEX one_canonical_capture_per_order ON captures(order_id) WHERE is_canonical;
ALTER TABLE orders ADD CONSTRAINT orders_canonical_payment_fk
  FOREIGN KEY (canonical_payment_id, id) REFERENCES captures(id, order_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE capacity_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  starts_at timestamptz NOT NULL,
  capacity_units integer NOT NULL CHECK (capacity_units >= 0),
  reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  committed_units integer NOT NULL DEFAULT 0 CHECK (committed_units >= 0),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, starts_at),
  CHECK (reserved_units + committed_units <= capacity_units)
);
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  slot_id uuid NOT NULL REFERENCES capacity_slots(id),
  units integer NOT NULL CHECK (units > 0),
  state text NOT NULL CHECK (state IN ('RESERVED','COMMITTED','RELEASED')),
  expires_at timestamptz NOT NULL,
  provider_terminal_unpaid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, slot_id),
  CHECK (state <> 'RELEASED' OR provider_terminal_unpaid_at IS NOT NULL)
);

CREATE TABLE operation_keys (
  scope text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  state text NOT NULL CHECK (state IN ('PENDING','SUCCEEDED','FAILED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, actor_id, idempotency_key)
);
CREATE TABLE webhook_inbox (
  provider_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','live')),
  signature_verified_at timestamptz NOT NULL,
  restricted_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text
);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_key text NOT NULL UNIQUE,
  order_id uuid REFERENCES orders(id),
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_outbox ON outbox_events(available_at) WHERE completed_at IS NULL;

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL REFERENCES captures(id),
  provider_refund_id text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status refund_state NOT NULL DEFAULT 'PENDING',
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  allocation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  revision integer NOT NULL,
  station_id text NOT NULL,
  ticket_type text NOT NULL CHECK (ticket_type IN ('PRODUCTION','HOLD','CANCELLATION','REPRINT')),
  original_job_id uuid,
  copy_number integer NOT NULL DEFAULT 0 CHECK (copy_number >= 0),
  authorized_by text,
  reason text,
  status print_state NOT NULL DEFAULT 'QUEUED',
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  template_version text NOT NULL,
  due_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  dispatch_authorized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, order_id),
  FOREIGN KEY (order_id, revision) REFERENCES order_revisions(order_id, revision),
  FOREIGN KEY (original_job_id, order_id) REFERENCES print_jobs(id, order_id),
  CHECK ((ticket_type = 'REPRINT' AND original_job_id IS NOT NULL AND copy_number > 0
    AND authorized_by IS NOT NULL AND reason IS NOT NULL AND length(trim(reason)) > 0)
    OR (ticket_type <> 'REPRINT' AND original_job_id IS NULL AND copy_number = 0))
);
CREATE UNIQUE INDEX one_original_kot ON print_jobs(order_id, revision, station_id, ticket_type)
  WHERE ticket_type = 'PRODUCTION';
CREATE UNIQUE INDEX unique_reprint_copy ON print_jobs(original_job_id, copy_number) WHERE ticket_type = 'REPRINT';
CREATE INDEX due_print_jobs ON print_jobs(due_at) WHERE status IN ('QUEUED','RETRY_WAIT');

CREATE TABLE print_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES print_jobs(id),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  bytes_may_have_been_sent boolean NOT NULL DEFAULT false,
  evidence text CHECK (evidence IN ('NO_OUTPUT_POSSIBLE','TRANSPORT_DELIVERED','DEVICE_CONFIRMED','UNKNOWN')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_code text,
  UNIQUE (job_id, fencing_token)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  order_id uuid REFERENCES orders(id),
  actor_id text NOT NULL,
  action text NOT NULL,
  reason text,
  safe_metadata jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record cannot be changed'; END;
$$;
CREATE TRIGGER frozen_order_revision BEFORE UPDATE OR DELETE ON order_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
CREATE TRIGGER append_only_audit BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();

CREATE FUNCTION preserve_print_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.order_id, NEW.revision, NEW.station_id, NEW.ticket_type, NEW.payload, NEW.payload_hash,
         NEW.template_version, NEW.original_job_id, NEW.copy_number)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.order_id, OLD.revision, OLD.station_id, OLD.ticket_type, OLD.payload, OLD.payload_hash,
         OLD.template_version, OLD.original_job_id, OLD.copy_number) THEN
    RAISE EXCEPTION 'Print identity and payload are immutable; create a new authorized job';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_print_payload BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION preserve_print_identity();

COMMENT ON TABLE refunds IS 'Budget must be checked under capture row lock across successful and pending refunds; application protocol not yet implemented.';
COMMENT ON TABLE capacity_slots IS 'Reserve counters and reservation rows together under row lock; database counter check alone is insufficient.';
COMMENT ON TABLE captures IS 'Canonical linkage, acceptance, reservation commitment and outbox insertion must commit in one transaction.';
COMMENT ON TABLE webhook_inbox IS 'Restricted payload retention and access policy required before production; do not log raw payloads.';
COMMIT;
