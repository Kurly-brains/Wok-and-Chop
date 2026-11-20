BEGIN;
SELECT pg_advisory_xact_lock(18315, 11);
DROP TABLE IF EXISTS customer_password_resets;
COMMIT;
