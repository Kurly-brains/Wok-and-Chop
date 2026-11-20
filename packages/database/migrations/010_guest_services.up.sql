BEGIN;
SELECT pg_advisory_xact_lock(18315, 10);

CREATE TABLE IF NOT EXISTS guest_contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 25),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 120),
  message text NOT NULL CHECK (length(message) BETWEEN 10 AND 3000),
  notification_mode text NOT NULL CHECK (notification_mode IN ('PREVIEW','QUEUED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  phone text NOT NULL CHECK (length(phone) BETWEEN 7 AND 25),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  reservation_date date NOT NULL,
  reservation_time time NOT NULL,
  time_zone text NOT NULL DEFAULT 'America/Toronto' CHECK (time_zone = 'America/Toronto'),
  starts_at timestamptz NOT NULL,
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','CONFIRMED','DECLINED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_message text NOT NULL DEFAULT '' CHECK (length(last_message) <= 500),
  notification_mode text NOT NULL CHECK (notification_mode IN ('PREVIEW','QUEUED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((starts_at AT TIME ZONE time_zone)::date = reservation_date),
  CHECK ((starts_at AT TIME ZONE time_zone)::time = reservation_time),
  CHECK (extract(second FROM reservation_time) = 0 AND extract(minute FROM reservation_time)::integer % 15 = 0)
);
CREATE INDEX IF NOT EXISTS guest_reservations_active ON guest_reservations(starts_at, id)
  WHERE status IN ('REQUESTED','CONFIRMED');

CREATE TABLE IF NOT EXISTS guest_reservation_events (
  reservation_id uuid NOT NULL REFERENCES guest_reservations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('REQUEST','CONFIRM','RESCHEDULE','DECLINE','CANCEL')),
  status text NOT NULL CHECK (status IN ('REQUESTED','CONFIRMED','DECLINED','CANCELLED')),
  reservation_date date NOT NULL,
  reservation_time time NOT NULL,
  starts_at timestamptz NOT NULL,
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 20),
  message text NOT NULL DEFAULT '' CHECK (length(message) <= 500),
  actor_account_id uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, version)
);

CREATE TABLE IF NOT EXISTS guest_submission_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0)
);

CREATE OR REPLACE FUNCTION protect_guest_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id,OLD.reservation_number,OLD.request_hash,OLD.request_fingerprint,OLD.name,OLD.email,OLD.phone,OLD.notes,OLD.created_at,OLD.time_zone)
    IS DISTINCT FROM ROW(NEW.id,NEW.reservation_number,NEW.request_hash,NEW.request_fingerprint,NEW.name,NEW.email,NEW.phone,NEW.notes,NEW.created_at,NEW.time_zone) THEN
    RAISE EXCEPTION 'Reservation guest identity and request evidence are immutable';
  END IF;
  IF OLD.status IN ('DECLINED','CANCELLED') OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Reservation update requires an active record and next version';
  END IF;
  IF NEW.status = 'REQUESTED' OR (OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('CONFIRMED','CANCELLED')) THEN
    RAISE EXCEPTION 'Invalid reservation status transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guest_reservation_guard ON guest_reservations;
CREATE TRIGGER guest_reservation_guard BEFORE UPDATE ON guest_reservations
  FOR EACH ROW EXECUTE FUNCTION protect_guest_reservation();
COMMIT;
