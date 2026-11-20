BEGIN;

CREATE TABLE IF NOT EXISTS notification_emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    recipient text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    reply_to text,
    status text NOT NULL CHECK (status IN ('PREVIEW','QUEUED','SENT','FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease uuid,
    lease_until timestamptz,
    sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_emails_ready ON notification_emails (next_attempt_at, created_at)
    WHERE status = 'QUEUED';

COMMIT;
