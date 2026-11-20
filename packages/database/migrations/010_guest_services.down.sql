BEGIN;
SELECT pg_advisory_xact_lock(18315, 10);
DROP TABLE IF EXISTS guest_reservation_events;
DROP TABLE IF EXISTS guest_reservations;
DROP FUNCTION IF EXISTS protect_guest_reservation();
DROP TABLE IF EXISTS guest_contact_messages;
DROP TABLE IF EXISTS guest_submission_limits;
COMMIT;
