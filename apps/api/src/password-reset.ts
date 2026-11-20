import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AuthService,
  hashPassword,
  normalizeAccountEmail,
  validateAccountPassword,
} from "./auth";
import { NOTIFICATION_MAILER, type NotificationMailer } from "./notifications";

type OriginRequest = Parameters<AuthService["checkOrigin"]>[0];
const maxAttempts = 5;
const invalidCode =
  "This code is invalid or expired. Request a new code if needed.";
const responseFloorMs = 250;

function resetFields(body: unknown, expected: string[]) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !expected.includes(key))
  ) {
    throw new BadRequestException("Check your password reset details.");
  }
  return body as Record<string, unknown>;
}

export class PasswordResetService {
  // Reset is served by the long-lived local API. An API restart invalidates pending codes.
  private readonly secret = randomBytes(32);

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(NOTIFICATION_MAILER) private readonly mailer: NotificationMailer,
  ) {}

  private digest(email: string, generation: string, code: string) {
    return createHmac("sha256", this.secret)
      .update(JSON.stringify([email, generation, code]))
      .digest();
  }

  async request(email: string) {
    if (!this.mailer.configured())
      throw new ServiceUnavailableException(
        "Password reset email is unavailable. Please try again later.",
      );

    const responseFloor = delay(responseFloorMs);
    const generation = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const result = await this.auth.database().query(
      `WITH account AS (
        SELECT id FROM customer_accounts WHERE email_normalized=$1 FOR NO KEY UPDATE
      )
      INSERT INTO customer_password_resets
        (account_id,generation,code_digest,requested_at,expires_at,window_started_at,sent_count)
      SELECT id,$2,$3,statement_timestamp(),statement_timestamp() + interval '10 minutes',statement_timestamp(),1
      FROM account
      ON CONFLICT (account_id) DO UPDATE SET
        generation=EXCLUDED.generation,
        code_digest=EXCLUDED.code_digest,
        requested_at=EXCLUDED.requested_at,
        expires_at=EXCLUDED.expires_at,
        attempts=0,
        consumed_at=NULL,
        window_started_at=CASE
          WHEN customer_password_resets.window_started_at <= EXCLUDED.requested_at - interval '1 hour'
          THEN EXCLUDED.requested_at ELSE customer_password_resets.window_started_at END,
        sent_count=CASE
          WHEN customer_password_resets.window_started_at <= EXCLUDED.requested_at - interval '1 hour'
          THEN 1 ELSE customer_password_resets.sent_count + 1 END
      WHERE customer_password_resets.requested_at <= EXCLUDED.requested_at - interval '1 minute'
        AND (customer_password_resets.sent_count < 3
          OR customer_password_resets.window_started_at <= EXCLUDED.requested_at - interval '1 hour')`,
      [email, generation, this.digest(email, generation, code)],
    );

    if (result.rowCount) {
      // The provider's timing and outcome cannot identify a registered address to callers.
      // Send immediately in memory and keep the plaintext code out of durable storage and logs.
      void Promise.resolve()
        .then(() =>
          this.mailer.send({
            to: email,
            subject: "Wok & Chop password reset code",
            text: `Your password reset code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this message.`,
          }),
        )
        .catch(() => {
          process.stderr.write(
            "Password reset email could not be delivered.\n",
          );
        });
    }
    await responseFloor;
  }

  async confirm(email: string, code: string, password: string) {
    const responseFloor = delay(responseFloorMs);
    const client = await this.auth.database().connect();
    let changed = false;
    try {
      await client.query("BEGIN");
      const accounts = await client.query<{ id: string }>(
        "SELECT id FROM customer_accounts WHERE email_normalized=$1 FOR NO KEY UPDATE",
        [email],
      );
      const account = accounts.rows[0];
      if (account) {
        const resets = await client.query<{
          generation: string;
          code_digest: Buffer;
        }>(
          `SELECT generation, code_digest FROM customer_password_resets
            WHERE account_id=$1 AND consumed_at IS NULL AND expires_at > clock_timestamp()
              AND attempts < $2 FOR UPDATE`,
          [account.id, maxAttempts],
        );
        const reset = resets.rows[0];
        if (
          reset &&
          timingSafeEqual(
            reset.code_digest,
            this.digest(email, reset.generation, code),
          )
        ) {
          const nextHash = await hashPassword(password);
          await client.query(
            "UPDATE customer_accounts SET password_hash=$2 WHERE id=$1",
            [account.id, nextHash],
          );
          await client.query(
            "UPDATE customer_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",
            [account.id],
          );
          await client.query(
            "UPDATE customer_password_resets SET consumed_at=clock_timestamp() WHERE account_id=$1",
            [account.id],
          );
          changed = true;
        } else if (reset) {
          await client.query(
            "UPDATE customer_password_resets SET attempts=attempts+1 WHERE account_id=$1",
            [account.id],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await responseFloor;
    if (!changed) throw new BadRequestException(invalidCode);
  }
}

@Controller("v1/auth/password-reset")
export class PasswordResetController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordResetService) private readonly resets: PasswordResetService,
  ) {}

  @Post("request")
  @HttpCode(202)
  async request(@Req() request: OriginRequest, @Body() body: unknown) {
    this.auth.checkOrigin(request);
    this.auth.limit(request, "password-reset-request");
    const { email } = resetFields(body, ["email"]);
    await this.resets.request(normalizeAccountEmail(email));
    return { ok: true };
  }

  @Post("confirm")
  @HttpCode(200)
  async confirm(@Req() request: OriginRequest, @Body() body: unknown) {
    this.auth.checkOrigin(request);
    this.auth.limit(request, "password-reset-confirm");
    const fields = resetFields(body, ["email", "code", "password"]);
    const email = normalizeAccountEmail(fields.email);
    if (typeof fields.code !== "string" || !/^\d{6}$/.test(fields.code))
      throw new BadRequestException(
        "Enter the six-digit code from your email.",
      );
    await this.resets.confirm(
      email,
      fields.code,
      validateAccountPassword(fields.password, true),
    );
    return { ok: true };
  }
}
