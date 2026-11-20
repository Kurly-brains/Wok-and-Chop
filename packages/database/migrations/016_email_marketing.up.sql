BEGIN;
SELECT pg_advisory_xact_lock(18315,16);

CREATE TABLE IF NOT EXISTS marketing_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
    generation uuid NOT NULL,
    source text NOT NULL CHECK (source = 'website-offers-v1'),
    requested_at timestamptz NOT NULL DEFAULT now(),
    confirmation_token_hash text,
    confirmation_expires_at timestamptz,
    confirmed_at timestamptz,
    unsubscribed_at timestamptz,
    CHECK ((confirmation_token_hash IS NULL) = (confirmation_expires_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_confirmation_token ON marketing_subscriptions (confirmation_token_hash)
    WHERE confirmation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_subscribers_active ON marketing_subscriptions (confirmed_at, id)
    WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id uuid PRIMARY KEY,
    created_by uuid REFERENCES customer_accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
    message text NOT NULL CHECK (length(message) BETWEEN 1 AND 3000),
    recipient_count integer NOT NULL CHECK (recipient_count > 0)
);

ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS marketing_subscription_id uuid REFERENCES marketing_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS marketing_generation uuid;
ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS marketing_kind text CHECK (marketing_kind IN ('CONFIRMATION', 'CAMPAIGN'));
ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS marketing_campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE CASCADE;
ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS marketing_unsubscribe_hash text;
ALTER TABLE notification_emails ADD COLUMN IF NOT EXISTS list_unsubscribe_url text;
ALTER TABLE notification_emails DROP CONSTRAINT IF EXISTS notification_emails_status_check;
ALTER TABLE notification_emails ADD CONSTRAINT notification_emails_status_check CHECK (status IN ('PREVIEW','QUEUED','SENT','FAILED','SUPPRESSED'));

CREATE INDEX IF NOT EXISTS marketing_email_budget ON notification_emails (created_at DESC)
    WHERE marketing_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_email_subscriber ON notification_emails (marketing_subscription_id)
    WHERE marketing_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_unsubscribe_token ON notification_emails (marketing_unsubscribe_hash)
    WHERE marketing_unsubscribe_hash IS NOT NULL;

COMMIT;
