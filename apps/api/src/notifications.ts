import { randomUUID } from "node:crypto";
import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { Pool, PoolClient } from "pg";
import type { AuthService } from "./auth";

export const staffEmail = "wokandchopottawa@gmail.com";
const senderEmail = "info@wokandchop.ca";
export const NOTIFICATION_MAILER = Symbol("NOTIFICATION_MAILER");

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  listUnsubscribe?: string;
};
type OfferEmail = { subscriptionId: string; generation: string } & (
  | { kind: "CONFIRMATION" }
  | { kind: "CAMPAIGN"; campaignId: string; unsubscribeHash: string }
);
export type NotificationMailer = {
  configured: () => boolean;
  send: (message: EmailMessage, messageId?: string) => Promise<void>;
};

export function emailConfigured() {
  return (
    Boolean(process.env.WOK_SMTP_PASSWORD) && process.env.NODE_ENV !== "test"
  );
}

export function validEmailAddress(value: string) {
  return (
    value.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(
      value,
    )
  );
}

export async function sendEmail(message: EmailMessage, messageId?: string) {
  if (!emailConfigured()) throw new Error("Hostinger SMTP is not configured.");
  if (
    !validEmailAddress(message.to) ||
    (message.replyTo && !validEmailAddress(message.replyTo))
  ) {
    throw new Error("Email requires a single valid address.");
  }
  const transport = createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: { user: senderEmail, pass: process.env.WOK_SMTP_PASSWORD! },
    connectionTimeout: 4000,
    greetingTimeout: 3500,
    socketTimeout: 5000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const result = await transport.sendMail({
    from: { name: "Wok & Chop", address: senderEmail },
    to: { name: "", address: message.to },
    replyTo: message.replyTo
      ? { name: "", address: message.replyTo }
      : undefined,
    subject: message.subject,
    text: message.text,
    list: message.listUnsubscribe
      ? { unsubscribe: message.listUnsubscribe }
      : undefined,
    headers: message.listUnsubscribe
      ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
    messageId,
  });
  if (result.accepted.length !== 1)
    throw new Error("SMTP did not accept the recipient.");
}

export const smtpMailer: NotificationMailer = {
  configured: emailConfigured,
  send: sendEmail,
};

export async function enqueueEmail(
  database: Pick<Pool, "query"> | PoolClient,
  message: EmailMessage,
  offer?: OfferEmail,
) {
  // Preview traffic is kept separate so enabling SMTP cannot release old test messages.
  // Offers are enqueued only after the marketing service verifies that a sender is configured.
  const status = offer || emailConfigured() ? "QUEUED" : "PREVIEW";
  await database.query(
    `INSERT INTO notification_emails (recipient,subject,body,reply_to,status,marketing_subscription_id,
       marketing_generation,marketing_kind,marketing_campaign_id,marketing_unsubscribe_hash,list_unsubscribe_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      message.to,
      message.subject,
      message.text,
      message.replyTo ?? null,
      status,
      offer?.subscriptionId ?? null,
      offer?.generation ?? null,
      offer?.kind ?? null,
      offer?.kind === "CAMPAIGN" ? offer.campaignId : null,
      offer?.kind === "CAMPAIGN" ? offer.unsubscribeHash : null,
      message.listUnsubscribe ?? null,
    ],
  );
}

type Job = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  reply_to: string | null;
  marketing_kind: OfferEmail["kind"] | null;
  list_unsubscribe_url: string | null;
};

export async function dispatchNextEmail(
  db: Pick<Pool, "query">,
  mailer: NotificationMailer,
) {
  if (!mailer.configured()) return false;
  const claim = randomUUID();
  const {
    rows: [job],
  } = await db.query<Job>(
    `UPDATE notification_emails SET lease = $1, lease_until = now() + interval '2 minutes', attempts = attempts + 1
     WHERE id = (
       SELECT id FROM notification_emails WHERE status = 'QUEUED' AND next_attempt_at <= now()
         AND (lease_until IS NULL OR lease_until <= now())
       ORDER BY (marketing_kind = 'CAMPAIGN') NULLS FIRST, next_attempt_at, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING id,recipient,subject,body,reply_to,marketing_kind,list_unsubscribe_url`,
    [claim],
  );
  if (!job) return false;
  if (job.marketing_kind) {
    // Check the exact opt-in generation immediately before sending. Older queued jobs cannot
    // go out after the guest withdraws consent, even if the same guest signs up again later.
    const suppressed = await db.query(
      `UPDATE notification_emails e SET status='SUPPRESSED', body='', reply_to=NULL,
         list_unsubscribe_url=NULL, lease=NULL, lease_until=NULL
       WHERE e.id=$1 AND e.lease=$2 AND NOT EXISTS (
         SELECT 1 FROM marketing_subscriptions s WHERE s.id=e.marketing_subscription_id
           AND s.generation=e.marketing_generation AND (
             (e.marketing_kind='CAMPAIGN' AND s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL)
             OR (e.marketing_kind='CONFIRMATION' AND s.confirmed_at IS NULL AND s.confirmation_expires_at > now())
           )
       )`,
      [job.id, claim],
    );
    if (suppressed.rowCount) return true;
  }
  try {
    const message: EmailMessage = {
      to: job.recipient,
      subject: job.subject,
      text: job.body,
      replyTo: job.reply_to ?? undefined,
    };
    if (job.list_unsubscribe_url)
      message.listUnsubscribe = job.list_unsubscribe_url;
    await mailer.send(message, `<${job.id}@wokandchop.ca>`);
  } catch {
    await db.query(
      `UPDATE notification_emails SET
       status = CASE WHEN attempts >= 8 THEN 'FAILED' ELSE 'QUEUED' END,
       next_attempt_at = now() + make_interval(mins => LEAST(60, (1 << attempts))),
       body = CASE WHEN marketing_kind IS NOT NULL AND attempts >= 8 THEN '' ELSE body END,
       list_unsubscribe_url = CASE WHEN attempts >= 8 THEN NULL ELSE list_unsubscribe_url END,
       lease = NULL, lease_until = NULL WHERE id = $1 AND lease = $2`,
      [job.id, claim],
    );
    return true;
  }
  await db.query(
    `UPDATE notification_emails SET status = 'SENT', sent_at = now(), body = '', reply_to = NULL, list_unsubscribe_url = NULL,
     lease = NULL, lease_until = NULL WHERE id = $1 AND lease = $2`,
    [job.id, claim],
  );
  return true;
}

export class EmailOutboxWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private pending?: Promise<unknown>;

  constructor(
    private readonly auth: AuthService,
    private readonly mailer: NotificationMailer,
    private readonly enabled: boolean,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled || !this.mailer.configured()) return;
    const tick = () => {
      if (this.pending) return;
      this.pending = Promise.resolve()
        .then(() => dispatchNextEmail(this.auth.database(), this.mailer))
        .catch(() =>
          process.stderr.write(
            "Could not process the restaurant email queue.\n",
          ),
        )
        .finally(() => {
          this.pending = undefined;
        });
    };
    this.timer = setInterval(tick, 3000);
    this.timer.unref();
    tick();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.pending;
  }
}
