import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import type { PoolClient } from "pg";
import { AuthService } from "./auth";
import {
  enqueueEmail,
  NOTIFICATION_MAILER,
  validEmailAddress,
  type NotificationMailer,
} from "./notifications";

type Request = Parameters<AuthService["me"]>[0];
type Response = Parameters<AuthService["me"]>[1];
type Subscription = { id: string; email: string; generation: string };
type Campaign = {
  id: string;
  subject: string;
  message: string;
  created_at: Date;
  recipient_count: number;
  created_by: string | null;
};

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
const consentSource = "website-offers-v1";
const restaurantSignature =
  "Wok & Chop\n790 Kanata Avenue, Unit M2A, Kanata, Ontario\ninfo@wokandchop.ca · (613) 591-1111";
const signupResponse = { ok: true };

function failure(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function fields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    failure(
      400,
      "INVALID_INPUT",
      "Check the email offer details and try again.",
    );
  }
  return body as Record<string, unknown>;
}

function checkedToken(value: unknown) {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    failure(
      400,
      "INVALID_LINK",
      "This email preferences link is invalid or has expired.",
    );
  }
  return value;
}

function publicSiteOrigin() {
  try {
    const configured = new URL(process.env.WOK_MARKETING_PUBLIC_URL ?? "");
    if (
      configured.protocol === "https:" &&
      configured.pathname === "/" &&
      !configured.username &&
      !configured.password &&
      !configured.search &&
      !configured.hash
    ) {
      return configured.origin;
    }
  } catch {
    return undefined;
  }
}

function offerLink(origin: string, path: string, token: string) {
  const link = new URL(path, origin);
  link.searchParams.set("token", token);
  return link.href;
}

function summary(campaign: Campaign) {
  return {
    id: campaign.id,
    subject: campaign.subject,
    message: campaign.message,
    createdAt: campaign.created_at.toISOString(),
    recipientCount: campaign.recipient_count,
  };
}

async function remainingEmailBudget(db: PoolClient) {
  const configured = Number(process.env.WOK_MARKETING_DAILY_LIMIT ?? 50);
  const limit =
    Number.isInteger(configured) && configured >= 1 && configured <= 500
      ? configured
      : 50;
  // Count outstanding messages, accepted sends and uncertain failures against the allowance.
  // The default leaves headroom for receipts and other mail from legacy 100-message Hostinger plans.
  const {
    rows: [{ used }],
  } = await db.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM notification_emails WHERE marketing_kind IS NOT NULL
     AND (status = 'QUEUED' OR sent_at > now() - interval '24 hours'
       OR (status = 'FAILED' AND created_at > now() - interval '24 hours'))`,
  );
  return Math.max(limit - used, 0);
}

export class MarketingService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(NOTIFICATION_MAILER) private readonly mailer: NotificationMailer,
  ) {}

  config() {
    return {
      emailEnabled: Boolean(this.mailer.configured() && publicSiteOrigin()),
    };
  }

  private origin() {
    const origin = publicSiteOrigin();
    if (!origin || !this.mailer.configured()) {
      failure(
        503,
        "MARKETING_EMAIL_UNAVAILABLE",
        "Email offers are temporarily unavailable.",
      );
    }
    return origin;
  }

  async subscribe(body: unknown) {
    const { email: input, consent } = fields(body, ["email", "consent"]);
    const email = typeof input === "string" ? input.trim().toLowerCase() : "";
    if (!validEmailAddress(email))
      failure(400, "INVALID_EMAIL", "Enter a valid email address.");
    if (consent !== true)
      failure(
        400,
        "CONSENT_REQUIRED",
        "Choose whether to receive email offers from Wok & Chop.",
      );
    const origin = this.origin();
    const token = newToken();
    const generation = randomUUID();
    const db = await this.auth.database().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(18316,1)");
      if (!(await remainingEmailBudget(db)))
        failure(
          429,
          "MARKETING_EMAIL_LIMIT",
          "Email signups are busy right now. Try again later.",
        );
      const {
        rows: [subscription],
      } = await db.query<Subscription>(
        `INSERT INTO marketing_subscriptions (email,generation,source,confirmation_token_hash,confirmation_expires_at)
         VALUES ($1,$2,$3,$4,now() + interval '24 hours')
         ON CONFLICT (email) DO UPDATE SET generation=EXCLUDED.generation, source=EXCLUDED.source,
           requested_at=EXCLUDED.requested_at, confirmation_token_hash=EXCLUDED.confirmation_token_hash,
           confirmation_expires_at=EXCLUDED.confirmation_expires_at, confirmed_at=NULL
         WHERE marketing_subscriptions.requested_at <= now() - interval '24 hours'
           AND (marketing_subscriptions.confirmed_at IS NULL OR marketing_subscriptions.unsubscribed_at IS NOT NULL)
         RETURNING id,email,generation`,
        [email, generation, consentSource, tokenHash(token)],
      );
      if (subscription) {
        const link = offerLink(origin, "/offers/confirm/", token);
        await enqueueEmail(
          db,
          {
            to: email,
            subject: "Confirm email offers from Wok & Chop",
            text: `Someone requested occasional offers from Wok & Chop using this email address. Confirm below if you’d like to receive them.\n\n${link}\n\nThis link expires in 24 hours. If you didn’t request it, you can ignore this message.\n\n${restaurantSignature}`,
          },
          { subscriptionId: subscription.id, generation, kind: "CONFIRMATION" },
        );
      }
      await db.query("COMMIT");
      return signupResponse;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async confirm(token: string) {
    const { rowCount } = await this.auth.database().query(
      `UPDATE marketing_subscriptions SET confirmed_at=COALESCE(confirmed_at,now()), unsubscribed_at=NULL
       WHERE confirmation_token_hash=$1 AND confirmation_expires_at > now()`,
      [tokenHash(token)],
    );
    if (!rowCount)
      failure(
        400,
        "INVALID_LINK",
        "This confirmation link is invalid or has expired. Request a new email to sign up.",
      );
    return signupResponse;
  }

  async unsubscribe(token: string) {
    const { rowCount } = await this.auth.database().query(
      `UPDATE marketing_subscriptions s
       SET unsubscribed_at=COALESCE(s.unsubscribed_at,now()), confirmation_token_hash=NULL, confirmation_expires_at=NULL
       FROM notification_emails e
       WHERE e.marketing_unsubscribe_hash=$1 AND s.id=e.marketing_subscription_id AND s.generation=e.marketing_generation`,
      [tokenHash(token)],
    );
    if (!rowCount)
      failure(
        400,
        "INVALID_LINK",
        "This unsubscribe link is invalid or no longer applies to your subscription.",
      );
    return signupResponse;
  }

  async overview(request: Request, response: Response) {
    const db = await this.auth.managerDatabase(request, response);
    const [subscribers, campaigns] = await Promise.all([
      db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM marketing_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL",
      ),
      db.query<Campaign>(
        "SELECT id,subject,message,created_at,recipient_count FROM marketing_campaigns ORDER BY created_at DESC,id DESC LIMIT 50",
      ),
    ]);
    return {
      ...this.config(),
      subscriberCount: subscribers.rows[0].count,
      campaigns: campaigns.rows.map(summary),
    };
  }

  async publish(body: unknown, request: Request, response: Response) {
    const { pool, accountId } = await this.auth.managerAccess(
      request,
      response,
    );
    const {
      requestId,
      subject: rawSubject,
      message: rawMessage,
    } = fields(body, ["requestId", "subject", "message"]);
    const subject = typeof rawSubject === "string" ? rawSubject.trim() : "";
    const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (typeof requestId !== "string" || !uuidPattern.test(requestId))
      failure(400, "INVALID_REQUEST", "Start a new email draft and try again.");
    if (
      !subject ||
      subject.length > 120 ||
      /[\p{Cc}\p{Zl}\p{Zp}]/u.test(subject)
    )
      failure(
        400,
        "INVALID_SUBJECT",
        "Enter an email subject with up to 120 characters on one line.",
      );
    if (
      !message ||
      message.length > 3000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(message)
    )
      failure(
        400,
        "INVALID_MESSAGE",
        "Enter a message with up to 3,000 characters.",
      );

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(18316,1)");
      const {
        rows: [existing],
      } = await db.query<Campaign>(
        "SELECT * FROM marketing_campaigns WHERE id=$1",
        [requestId],
      );
      if (existing) {
        if (
          existing.created_by !== accountId ||
          existing.subject !== subject ||
          existing.message !== message
        ) {
          failure(
            409,
            "CAMPAIGN_REQUEST_CONFLICT",
            "This send already belongs to a different offer. Start a new draft to send another.",
          );
        }
        await db.query("COMMIT");
        return summary(existing);
      }

      const origin = this.origin();
      const budget = await remainingEmailBudget(db);
      const { rows: subscribers } = await db.query<Subscription>(
        `SELECT id,email,generation FROM marketing_subscriptions
         WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL
         ORDER BY confirmed_at,id LIMIT $1 FOR SHARE`,
        [budget + 1],
      );
      if (!subscribers.length)
        failure(
          409,
          "NO_SUBSCRIBERS",
          "There are no confirmed email subscribers yet.",
        );
      if (subscribers.length > budget) {
        failure(
          429,
          "MARKETING_EMAIL_LIMIT",
          "This send exceeds the remaining email allowance. Try again after the current email window resets.",
        );
      }
      const {
        rows: [campaign],
      } = await db.query<Campaign>(
        `INSERT INTO marketing_campaigns (id,created_by,subject,message,recipient_count)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [requestId, accountId, subject, message, subscribers.length],
      );
      for (const subscription of subscribers) {
        const token = newToken();
        const unsubscribe = offerLink(origin, "/offers/unsubscribe/", token);
        await enqueueEmail(
          db,
          {
            to: subscription.email,
            subject,
            text: `${message}\n\n${restaurantSignature}\n\nYou subscribed to email offers from Wok & Chop. Unsubscribe: ${unsubscribe}`,
            listUnsubscribe: offerLink(
              origin,
              "/v1/marketing/unsubscribe/",
              token,
            ),
          },
          {
            subscriptionId: subscription.id,
            generation: subscription.generation,
            kind: "CAMPAIGN",
            campaignId: campaign.id,
            unsubscribeHash: tokenHash(token),
          },
        );
      }
      await db.query("COMMIT");
      return summary(campaign);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}

@Controller("v1/marketing")
export class MarketingController {
  constructor(
    @Inject(MarketingService) private readonly marketing: MarketingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("config")
  config() {
    return this.marketing.config();
  }

  @Post("subscribe")
  @HttpCode(202)
  subscribe(@Req() request: Request, @Body() body: unknown) {
    this.auth.checkOrigin(request);
    this.auth.limit(request, "marketing-subscribe");
    return this.marketing.subscribe(body);
  }

  @Post("confirm")
  @HttpCode(200)
  confirm(@Req() request: Request, @Body() body: unknown) {
    this.auth.checkOrigin(request);
    this.auth.limit(request, "marketing-confirm");
    return this.marketing.confirm(checkedToken(fields(body, ["token"]).token));
  }

  @Post("unsubscribe")
  @HttpCode(200)
  @UseInterceptors(
    NoFilesInterceptor({ limits: { fields: 1, parts: 2, fieldSize: 32 } }),
  )
  unsubscribe(
    @Req() request: Request,
    @Body() body: unknown,
    @Query("token") oneClickToken: unknown,
  ) {
    if (oneClickToken !== undefined) {
      const type = request.headers["content-type"];
      if (
        typeof type !== "string" ||
        !/^(?:application\/x-www-form-urlencoded|multipart\/form-data)(?:\s*;|$)/i.test(
          type,
        ) ||
        fields(body, ["List-Unsubscribe"])["List-Unsubscribe"] !== "One-Click"
      ) {
        failure(400, "INVALID_LINK", "This unsubscribe request is invalid.");
      }
      return this.marketing.unsubscribe(checkedToken(oneClickToken));
    }
    this.auth.checkOrigin(request);
    return this.marketing.unsubscribe(
      checkedToken(fields(body, ["token"]).token),
    );
  }
}

@Controller("v1/auth/admin/marketing")
export class AdminMarketingController {
  constructor(
    @Inject(MarketingService) private readonly marketing: MarketingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  overview(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.marketing.overview(request, response);
  }

  @Post()
  @HttpCode(202)
  publish(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    this.auth.checkOrigin(request);
    return this.marketing.publish(body, request, response);
  }
}
