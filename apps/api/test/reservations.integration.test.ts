import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { torontoInstant } from "../src/reservations";

// These tests may persist email previews, but must never submit SMTP mail.
process.env.NODE_ENV = "test";
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("Toronto wall times reject daylight-saving gaps, repeated hours and invalid dates", () => {
  assert.equal(
    torontoInstant("2027-01-15", "18:30").toISOString(),
    "2027-01-15T23:30:00.000Z",
  );
  assert.equal(
    torontoInstant("2027-07-15", "18:30").toISOString(),
    "2027-07-15T22:30:00.000Z",
  );
  assert.throws(() => torontoInstant("2027-03-14", "02:30"));
  assert.throws(() => torontoInstant("2027-11-07", "01:30"));
  assert.throws(() => torontoInstant("2027-02-30", "18:00"));
  assert.throws(() => torontoInstant("2027-07-15", "18:01"));
  assert.throws(() => torontoInstant("2027-07-15", "24:00"));
});

test("guest services are closed without their local database", async () => {
  const app = await createApplication({
    webOrigin: origin,
    trainingDatabasePath: ":memory:",
  });
  try {
    await app.listen(0, "127.0.0.1");
    const result = await fetch(
      `${await app.getUrl()}/v1/guest-services/config`,
    );
    assert.equal(result.status, 200);
    const config = await result.json();
    assert.equal(config.contactEnabled, false);
    assert.equal(config.reservationsEnabled, false);
    assert.equal(config.emailEnabled, false);
  } finally {
    await app.close();
  }
});

test(
  "contact and reservation requests are durable, private, idempotent and serialized with notification intent",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required.");
    const db = new Pool({ connectionString: databaseUrl });
    const emails: string[] = [];
    const syntheticEmail = () => {
      const email = `guest-${randomUUID()}@example.invalid`;
      emails.push(email);
      return email;
    };
    const contactEmail = syntheticEmail();
    const reservationEmail = syntheticEmail();
    const rollbackEmail = syntheticEmail();
    const limitedEmail = syntheticEmail();
    const triggerName = "guest_email_failure_" + randomUUID().replace(/-/g, "");
    const ipKeys = ["contact", "reservation"].map((channel) =>
      digest(`${channel}:ip:127.0.0.1`),
    );
    let triggerCreated = false;
    let app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
    });
    try {
      await db.query(
        "DELETE FROM guest_submission_limits WHERE key_hash=ANY($1::text[])",
        [ipKeys],
      );
      await app.listen(0, "127.0.0.1");
      let base = `${await app.getUrl()}/v1/`;
      const get = (path: string, cookie?: string) =>
        fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
      const post = (
        path: string,
        body: unknown,
        cookie?: string,
        requestOrigin = origin,
      ) =>
        fetch(base + path, {
          method: "POST",
          headers: {
            Origin: requestOrigin,
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        });
      async function account(manager = false) {
        const result = await post("auth/register", {
          name: "Synthetic guest services account",
          email: syntheticEmail(),
          password: "Synthetic guest services password!",
        });
        assert.equal(result.status, 201);
        const { user } = await result.json();
        if (manager)
          await db.query(
            "INSERT INTO restaurant_managers(account_id) VALUES($1)",
            [user.id],
          );
        return {
          id: user.id as string,
          cookie: result.headers.get("set-cookie")!.split(";")[0],
        };
      }
      const manager = await account(true);
      const customer = await account();
      const config = await (await get("guest-services/config")).json();
      assert.equal(config.contactEnabled, true);
      assert.equal(config.reservationsEnabled, true);
      assert.equal(config.emailEnabled, false);
      assert.equal(config.timeZone, "America/Toronto");
      assert.equal((await get("auth/admin/reservations")).status, 401);
      assert.equal(
        (await get("auth/admin/contact", customer.cookie)).status,
        403,
      );

      const contact = {
        name: "Synthetic contact",
        email: contactEmail,
        phone: "613-555-0100",
        subject: "Synthetic enquiry",
        message: "This is a synthetic contact message.",
        requestId: randomUUID(),
      };
      assert.equal(
        (
          await post(
            "contact",
            contact,
            undefined,
            "https://untrusted.example.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post("contact", {
            ...contact,
            email: "victim@example.invalid\r\nBcc: injected@example.invalid",
          })
        ).status,
        400,
      );
      assert.equal(
        (await post("contact", { ...contact, admin: true })).status,
        400,
      );
      assert.equal(
        (await post("contact", { ...contact, phone: "not a telephone" }))
          .status,
        400,
      );
      const contacts = await Promise.all([
        post("contact", contact),
        post("contact", contact),
        post("contact", contact),
      ]);
      assert.deepEqual(
        contacts.map((response) => response.status),
        [201, 201, 201],
      );
      const contactReceipts = await Promise.all(
        contacts.map((response) => response.json()),
      );
      assert.equal(
        new Set(contactReceipts.map((receipt) => receipt.contact.number)).size,
        1,
      );
      assert.equal(contactReceipts[0].emailQueued, false);
      assert.equal(contactReceipts[0].notificationMode, "PREVIEW");
      assert.equal(
        (
          await post("contact", {
            ...contact,
            message: "This changed payload must not overwrite the first.",
          })
        ).status,
        409,
      );
      const inbox = await (
        await get("auth/admin/contact", manager.cookie)
      ).json();
      assert.equal(
        inbox.contacts.find(
          (item: { email: string }) => item.email === contactEmail,
        ).message,
        contact.message,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM notification_emails WHERE recipient=$1 OR reply_to=$1",
            [contactEmail],
          )
        ).rows[0].count,
        2,
      );

      const date = new Date(Date.now() + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const reservation = {
        name: "Synthetic reservation",
        email: reservationEmail,
        phone: "+1 613 555 0101",
        date,
        time: "18:00",
        partySize: 4,
        notes: "Synthetic private note; do not copy to staff email.",
        requestId: randomUUID(),
      };
      assert.equal(
        (await post("reservations", { ...reservation, date: "2020-01-01" }))
          .status,
        400,
      );
      assert.equal(
        (await post("reservations", { ...reservation, partySize: 21 })).status,
        400,
      );
      const receipts = await Promise.all([
        post("reservations", reservation),
        post("reservations", reservation),
      ]);
      assert.deepEqual(
        receipts.map((response) => response.status),
        [201, 201],
      );
      const responseBodies = await Promise.all(
        receipts.map((response) => response.json()),
      );
      assert.equal(
        responseBodies[0].reservation.number,
        responseBodies[1].reservation.number,
      );
      assert.equal(responseBodies[0].reservation.status, "REQUESTED");
      assert.equal(responseBodies[0].reservation.timeZone, "America/Toronto");
      assert.equal("email" in responseBodies[0].reservation, false);
      assert.equal(
        (await post("reservations", { ...reservation, partySize: 5 })).status,
        409,
      );
      const list = await (
        await get("auth/admin/reservations", manager.cookie)
      ).json();
      const saved = list.reservations.find(
        (item: { email: string }) => item.email === reservationEmail,
      );
      assert.equal(saved.notes, reservation.notes);
      assert.equal(saved.version, 1);
      const persisted = (
        await db.query("SELECT starts_at FROM guest_reservations WHERE id=$1", [
          saved.id,
        ])
      ).rows[0];
      assert.equal(
        persisted.starts_at.toISOString(),
        torontoInstant(date, "18:00").toISOString(),
      );
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            { version: 1, action: "CONFIRM" },
            customer.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            { version: 1, action: "CONFIRM" },
            manager.cookie,
            "https://untrusted.example.invalid",
          )
        ).status,
        403,
      );
      const competing = await Promise.all([
        post(
          `auth/admin/reservations/${saved.id}`,
          { version: 1, action: "CONFIRM" },
          manager.cookie,
        ),
        post(
          `auth/admin/reservations/${saved.id}`,
          { version: 1, action: "CONFIRM" },
          manager.cookie,
        ),
      ]);
      assert.deepEqual(
        competing.map((response) => response.status).sort(),
        [200, 409],
      );
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            { version: 2, action: "RESCHEDULE", date, time: "18:00" },
            manager.cookie,
          )
        ).status,
        400,
      );
      const rescheduled = await post(
        `auth/admin/reservations/${saved.id}`,
        {
          version: 2,
          action: "RESCHEDULE",
          date,
          time: "18:00",
          partySize: 5,
          message: "Synthetic change approved.",
        },
        manager.cookie,
      );
      assert.equal(rescheduled.status, 200);
      assert.equal((await rescheduled.json()).reservation.version, 3);
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            {
              version: 2,
              action: "CANCEL",
              message: "Synthetic cancellation.",
            },
            manager.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            { version: 3, action: "CANCEL" },
            manager.cookie,
          )
        ).status,
        400,
      );
      const cancelled = await post(
        `auth/admin/reservations/${saved.id}`,
        { version: 3, action: "CANCEL", message: "Synthetic cancellation." },
        manager.cookie,
      );
      assert.equal(cancelled.status, 200);
      assert.equal((await cancelled.json()).reservation.status, "CANCELLED");
      assert.equal(
        (
          await post(
            `auth/admin/reservations/${saved.id}`,
            { version: 4, action: "CONFIRM" },
            manager.cookie,
          )
        ).status,
        409,
      );
      const audit = await db.query(
        "SELECT version,action,actor_account_id FROM guest_reservation_events WHERE reservation_id=$1 ORDER BY version",
        [saved.id],
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        ["REQUEST", "CONFIRM", "RESCHEDULE", "CANCEL"],
      );
      assert.equal(audit.rows[1].actor_account_id, manager.id);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM notification_emails WHERE recipient=$1 OR reply_to=$1",
            [reservationEmail],
          )
        ).rows[0].count,
        5,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM notification_emails WHERE reply_to=$1 AND body LIKE '%Synthetic private note%'",
            [reservationEmail],
          )
        ).rows[0].count,
        0,
      );

      const second = await (
        await post("reservations", { ...reservation, requestId: randomUUID() })
      ).json();
      const secondId = (
        await (await get("auth/admin/reservations", manager.cookie)).json()
      ).reservations.find(
        (item: { number: string }) => item.number === second.reservation.number,
      ).id;
      const declined = await post(
        `auth/admin/reservations/${secondId}`,
        { version: 1, action: "DECLINE", message: "Synthetic unavailability." },
        manager.cookie,
      );
      assert.equal(declined.status, 200);
      assert.equal((await declined.json()).reservation.status, "DECLINED");
      const active = await (
        await get("auth/admin/reservations", manager.cookie)
      ).json();
      assert.equal(
        active.reservations.some((item: { id: string }) =>
          [saved.id, secondId].includes(item.id),
        ),
        false,
      );

      // A notification write failure must roll back the accepted request and rate charge.
      await db.query(
        `CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.recipient='${rollbackEmail}' THEN RAISE EXCEPTION 'synthetic notification failure'; END IF; RETURN NEW; END; $$`,
      );
      await db.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON notification_emails FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`,
      );
      triggerCreated = true;
      const rollbackRequest = {
        ...contact,
        email: rollbackEmail,
        requestId: randomUUID(),
      };
      assert.equal((await post("contact", rollbackRequest)).status, 500);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM guest_contact_messages WHERE email=$1",
            [rollbackEmail],
          )
        ).rows[0].count,
        0,
      );
      await db.query(`DROP TRIGGER ${triggerName} ON notification_emails`);
      await db.query(`DROP FUNCTION ${triggerName}()`);
      triggerCreated = false;
      assert.equal((await post("contact", rollbackRequest)).status, 201);

      await db.query(
        "INSERT INTO guest_submission_limits(key_hash,window_start,count) VALUES($1,date_trunc('hour',now()),3)",
        [digest(`contact:email:${limitedEmail}`)],
      );
      await app.close();
      app = await createApplication({
        authDatabaseUrl: databaseUrl,
        webOrigin: origin,
        trainingDatabasePath: ":memory:",
      });
      await app.listen(0, "127.0.0.1");
      base = `${await app.getUrl()}/v1/`;
      assert.equal(
        (
          await post("contact", {
            ...contact,
            email: limitedEmail,
            requestId: randomUUID(),
          })
        ).status,
        429,
      );
      const history = await (
        await get("auth/admin/reservations?scope=all", manager.cookie)
      ).json();
      assert.equal(
        history.reservations.find(
          (item: { id: string }) => item.id === saved.id,
        ).status,
        "CANCELLED",
      );
      const notificationStates = await db.query(
        "SELECT DISTINCT status FROM notification_emails WHERE recipient=ANY($1::text[]) OR reply_to=ANY($1::text[])",
        [emails],
      );
      assert.deepEqual(
        notificationStates.rows.map((row) => row.status),
        ["PREVIEW"],
      );
    } finally {
      await app.close();
      if (triggerCreated) {
        await db.query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON notification_emails`,
        );
        await db.query(`DROP FUNCTION IF EXISTS ${triggerName}()`);
      }
      await db.query(
        "DELETE FROM notification_emails WHERE recipient=ANY($1::text[]) OR reply_to=ANY($1::text[])",
        [emails],
      );
      await db.query(
        "DELETE FROM guest_reservations WHERE email=ANY($1::text[])",
        [emails],
      );
      await db.query(
        "DELETE FROM guest_contact_messages WHERE email=ANY($1::text[])",
        [emails],
      );
      await db.query(
        "DELETE FROM customer_accounts WHERE email_normalized=ANY($1::text[])",
        [emails],
      );
      await db.query(
        "DELETE FROM guest_submission_limits WHERE key_hash=ANY($1::text[])",
        [
          [
            ...ipKeys,
            ...emails.flatMap((email) => [
              digest(`contact:email:${email}`),
              digest(`reservation:email:${email}`),
            ]),
          ],
        ],
      );
      await db.end();
    }
  },
);
