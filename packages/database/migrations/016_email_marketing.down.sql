BEGIN;
SELECT pg_advisory_xact_lock(18315,16);

-- Remove offer jobs before reversing so they can never be delivered as ordinary notifications.
DELETE FROM notification_emails WHERE marketing_subscription_id IS NOT NULL;
ALTER TABLE notification_emails DROP CONSTRAINT IF EXISTS notification_emails_status_check;
ALTER TABLE notification_emails ADD CONSTRAINT notification_emails_status_check CHECK (status IN ('PREVIEW','QUEUED','SENT','FAILED'));
ALTER TABLE notification_emails DROP COLUMN IF EXISTS marketing_subscription_id;
ALTER TABLE notification_emails DROP COLUMN IF EXISTS marketing_generation;
ALTER TABLE notification_emails DROP COLUMN IF EXISTS marketing_kind;
ALTER TABLE notification_emails DROP COLUMN IF EXISTS marketing_campaign_id;
ALTER TABLE notification_emails DROP COLUMN IF EXISTS marketing_unsubscribe_hash;
ALTER TABLE notification_emails DROP COLUMN IF EXISTS list_unsubscribe_url;
DROP TABLE IF EXISTS marketing_campaigns;
DROP TABLE IF EXISTS marketing_subscriptions;

COMMIT;
