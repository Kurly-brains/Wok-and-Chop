BEGIN;
SELECT pg_advisory_xact_lock(18315,17);

CREATE TABLE IF NOT EXISTS guest_reservation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  paused boolean NOT NULL DEFAULT false,
  notice text NOT NULL DEFAULT '' CHECK (length(notice) <= 280),
  first_time time NOT NULL DEFAULT '00:00',
  last_time time NOT NULL DEFAULT '23:45',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
  CHECK (first_time <= last_time AND last_time <= '23:45'),
  CHECK (extract(second FROM first_time) = 0 AND extract(minute FROM first_time)::int % 15 = 0),
  CHECK (extract(second FROM last_time) = 0 AND extract(minute FROM last_time)::int % 15 = 0)
);
INSERT INTO guest_reservation_settings(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS guest_reservation_closures (
  closed_date date PRIMARY KEY CHECK (closed_date BETWEEN '2000-01-01' AND '2099-12-31'),
  notice text NOT NULL DEFAULT '' CHECK (length(notice) <= 280)
);

COMMIT;
