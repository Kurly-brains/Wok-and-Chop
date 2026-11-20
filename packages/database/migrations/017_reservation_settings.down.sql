BEGIN;
SELECT pg_advisory_xact_lock(18315,17);

-- Reversing drops the online booking policy only. Existing guest requests and events stay intact.
DROP TABLE IF EXISTS guest_reservation_closures;
DROP TABLE IF EXISTS guest_reservation_settings;

COMMIT;
