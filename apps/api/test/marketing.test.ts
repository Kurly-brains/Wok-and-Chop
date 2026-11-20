import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { dispatchNextEmail, type EmailMessage } from "../src/notifications";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const webOrigin = "http://127.0.0.1:3000";
const linkOrigin = "https://offers.example.invalid";

test(
  "email offers require consent, queue once and stop after unsubscribe",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    delete process.env.WOK_MARKETING_PUBLIC_URL;
    process.env.WOK_MARKETING_DAILY_LIMIT = "20";
    const db = new Pool({ connectionString: databaseUrl });
    const captured: EmailMessage[] = [];
    const mailer = {
      configured: () => true,
      send: async (message: EmailMessage) => {
        captured.push(message);
      },
    };
    const app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin,
      mailer,
    });
    const fixturePrefix = `marketing-${randomUUID()}`;
    const guest = `${fixturePrefix}-guest@example.invalid`;
    const expiryGuest = `${fixturePrefix}-expired@example.invalid`;
    const customer = `${fixturePrefix}-customer@example.invalid`;
    const manager = `${fixturePrefix}-manager@example.invalid`;
    const requestIds = [randomUUID(), randomUUID(), randomUUID()];
    try {
      await app.listen(0, "127.0.0.1");
      const address = await app.getUrl();
      const send = (
        path: string,
        body: unknown,
        cookie?: string,
        origin = webOrigin,
      ) =>
        fetch(address + path, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        });
      const subscribe = (body: unknown) =>
        send("/v1/marketing/subscribe", body);
      const config = async () =>
        (await fetch(address + "/v1/marketing/config")).json();
      const overview = (cookie?: string) =>
        fetch(address + "/v1/auth/admin/marketing", {
          headers: cookie ? { Cookie: cookie } : {},
        });
      const draft = (id: string) => ({
        requestId: id,
        subject: "Sample offer",
        message: "20% off your pickup order.",
      });
      const publish = (body: unknown, cookie?: string) =>
        send("/v1/auth/admin/marketing", body, cookie);
      const register = async (email: string, staff: boolean) => {
        const result = await send("/v1/auth/register", {
          email,
          name: "Synthetic marketing fixture",
          password: "Synthetic fixture password!",
        });
        assert.equal(result.status, 201);
        const { user } = await result.json();
        if (staff)
          await db.query(
            "INSERT INTO restaurant_managers(account_id) VALUES($1)",
            [user.id],
          );
        return result.headers.getSetCookie()[0].split(";")[0];
      };

      assert.deepEqual(await config(), { emailEnabled: false });
      assert.equal(
        (await subscribe({ email: guest, consent: true })).status,
        503,
      );
      process.env.WOK_MARKETING_PUBLIC_URL = linkOrigin;
      assert.deepEqual(await config(), { emailEnabled: true });
      assert.equal((await overview()).status, 401);
      const customerCookie = await register(customer, false);
      const managerCookie = await register(manager, true);
      assert.equal(
        (await publish(draft(requestIds[0]), customerCookie)).status,
        403,
      );
      assert.equal(
        (
          await send(
            "/v1/marketing/subscribe",
            { email: guest, consent: true },
            undefined,
            "https://elsewhere.example.invalid",
          )
        ).status,
        403,
      );
      assert.equal((await subscribe({ email: guest })).status, 400);
      assert.equal(
        (await subscribe({ email: guest, consent: true })).status,
        202,
      );
      assert.equal(
        (await subscribe({ email: guest.toUpperCase(), consent: true })).status,
        202,
      );
      assert.equal(
        (await overview(managerCookie).then((result) => result.json()))
          .subscriberCount,
        0,
      );
      assert.equal(
        (await publish(draft(requestIds[0]), managerCookie)).status,
        409,
      );

      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(await dispatchNextEmail(db, mailer), false);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].to, guest);
      const confirmUrl = new URL(captured[0].text.match(/https:\/\/\S+/)![0]);
      assert.equal(confirmUrl.origin, linkOrigin);
      assert.equal(confirmUrl.pathname, "/offers/confirm/");
      const confirmToken = confirmUrl.searchParams.get("token");
      assert.equal(
        (await send("/v1/marketing/confirm", { token: confirmToken })).status,
        200,
      );
      assert.equal(
        (await send("/v1/marketing/confirm", { token: confirmToken })).status,
        200,
      );
      assert.equal(
        (await overview(managerCookie).then((result) => result.json()))
          .subscriberCount,
        1,
      );

      const [first, retry] = await Promise.all([
        publish(draft(requestIds[0]), managerCookie),
        publish(draft(requestIds[0]), managerCookie),
      ]);
      assert.equal(first.status, 202);
      assert.equal(retry.status, 202);
      const campaign = await first.json();
      assert.deepEqual(campaign, await retry.json());
      assert.equal(campaign.recipientCount, 1);
      assert.equal(
        (
          await publish(
            { ...draft(requestIds[0]), subject: "Changed" },
            managerCookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await publish(
            {
              ...draft(requestIds[1]),
              subject: "Injected\r\nBcc: hidden@example.invalid",
            },
            managerCookie,
          )
        ).status,
        400,
      );
      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(await dispatchNextEmail(db, mailer), false);
      assert.equal(captured.length, 2);
      const offer = captured[1];
      assert.equal(offer.to, guest);
      assert.match(offer.text, /790 Kanata Avenue/);
      const unsubscribeUrl = new URL(offer.text.match(/https:\/\/\S+/)![0]);
      const oneClick = new URL(offer.listUnsubscribe!);
      assert.equal(unsubscribeUrl.pathname, "/offers/unsubscribe/");
      assert.equal(oneClick.pathname, "/v1/marketing/unsubscribe/");
      assert.equal(oneClick.search, unsubscribeUrl.search);
      assert.equal(
        (await publish(draft(requestIds[1]), managerCookie)).status,
        202,
      );
      const endpoint = address + oneClick.pathname + oneClick.search;
      assert.equal(
        (
          await fetch(endpoint, {
            method: "POST",
            body: new URLSearchParams({ "List-Unsubscribe": "Wrong" }),
          })
        ).status,
        400,
      );
      const form = new FormData();
      form.set("List-Unsubscribe", "One-Click");
      assert.equal(
        (await fetch(endpoint, { method: "POST", body: form })).status,
        200,
      );
      assert.equal(
        (
          await fetch(endpoint, {
            method: "POST",
            body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
          })
        ).status,
        200,
      );
      assert.equal(
        (await send("/v1/marketing/confirm", { token: confirmToken })).status,
        400,
      );
      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(captured.length, 2);
      const [{ status, body, list_unsubscribe_url: header }] = (
        await db.query(
          "SELECT status,body,list_unsubscribe_url FROM notification_emails WHERE marketing_campaign_id=$1",
          [requestIds[1]],
        )
      ).rows;
      assert.equal(status, "SUPPRESSED");
      assert.equal(body, "");
      assert.equal(header, null);

      assert.equal(
        (await subscribe({ email: expiryGuest, consent: true })).status,
        202,
      );
      await db.query(
        "UPDATE marketing_subscriptions SET confirmation_expires_at = now() - interval '1 minute' WHERE email=$1",
        [expiryGuest],
      );
      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(captured.length, 2);
      const report = await overview(managerCookie).then((result) =>
        result.json(),
      );
      assert.equal(report.subscriberCount, 0);
      assert.equal(report.campaigns.length, 2);
      assert.doesNotMatch(JSON.stringify(report), /@example.invalid/);
      process.env.WOK_MARKETING_DAILY_LIMIT = "1";
      assert.equal(
        (await subscribe({ email: customer, consent: true })).status,
        429,
      );
    } finally {
      await app.close();
      await db.query(
        "DELETE FROM marketing_campaigns WHERE id=ANY($1::uuid[])",
        [requestIds],
      );
      await db.query(
        "DELETE FROM marketing_subscriptions WHERE email IN ($1,$2,$3)",
        [guest, expiryGuest, customer],
      );
      await db.query(
        "DELETE FROM customer_accounts WHERE email_normalized IN ($1,$2)",
        [customer, manager],
      );
      await db.end();
    }
  },
);
