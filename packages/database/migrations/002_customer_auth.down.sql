-- Destructive: use only for disposable development databases with no retained accounts.
BEGIN;
DROP TABLE customer_sessions;
DROP TABLE customer_accounts;
COMMIT;
