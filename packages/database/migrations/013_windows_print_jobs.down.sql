BEGIN;
SELECT pg_advisory_xact_lock(18315,13);
DROP TABLE IF EXISTS windows_print_jobs;
DROP FUNCTION IF EXISTS protect_windows_print_intent();
COMMIT;
