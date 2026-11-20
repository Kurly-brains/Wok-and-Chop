import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { dispatchNextEmail, type EmailMessage } from "../src/notifications";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

test(
  "the email worker isolates previews and retries with the same message ID",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const pool = new Pool({ connectionString: databaseUrl });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "CREATE TEMP TABLE notification_emails (LIKE public.notification_emails INCLUDING ALL) ON COMMIT DROP",
      );
      await db.query(
        "INSERT INTO notification_emails(recipient,subject,body,status) VALUES ($1,$2,$3,'PREVIEW'), ($1,$2,$3,'QUEUED')",
        ["test@example.invalid", "Sample order", "Sample body"],
      );
      const observed: string[] = [];
      let shouldFail = true;
      const mailer = {
        configured: () => true,
        async send(message: EmailMessage, messageId?: string) {
          assert.equal(message.to, "test@example.invalid");
          assert.match(messageId ?? "", /^<[0-9a-f-]+@wokandchop\.ca>$/);
          observed.push(messageId!);
          if (shouldFail) throw new Error("Mock SMTP is temporarily offline");
        },
      };
      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(await dispatchNextEmail(db, mailer), false);
      await db.query(
        "UPDATE notification_emails SET next_attempt_at = now() WHERE status='QUEUED'",
      );
      shouldFail = false;
      assert.equal(await dispatchNextEmail(db, mailer), true);
      assert.equal(await dispatchNextEmail(db, mailer), false);
      assert.equal(observed.length, 2);
      assert.equal(observed[0], observed[1]);
      const jobs = await db.query(
        "SELECT status, body, attempts FROM notification_emails ORDER BY status",
      );
      assert.deepEqual(jobs.rows, [
        { status: "PREVIEW", body: "Sample body", attempts: 0 },
        { status: "SENT", body: "", attempts: 2 },
      ]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  },
);

test(
  "email dispatch waits for active leases, recovers expired work and stops after eight failures",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const pool = new Pool({ connectionString: databaseUrl });
    const db = await pool.connect();
    let sends = 0;
    const mailer = {
      configured: () => true,
      send: async () => {
        sends++;
        throw new Error("Synthetic SMTP failure");
      },
    };
    try {
      await db.query("BEGIN");
      await db.query(
        "CREATE TEMP TABLE notification_emails (LIKE public.notification_emails INCLUDING ALL) ON COMMIT DROP",
      );
      await db.query(
        "INSERT INTO notification_emails(recipient,subject,body,status,lease,lease_until) VALUES ('test@example.invalid','Synthetic retry limit','Synthetic body','QUEUED',$1,now()+interval '1 minute')",
        [randomUUID()],
      );
      assert.equal(await dispatchNextEmail(db, mailer), false);
      assert.equal(sends, 0);
      await db.query(
        "UPDATE notification_emails SET lease_until=now()-interval '1 minute'",
      );
      assert.equal(
        await dispatchNextEmail(db, { ...mailer, configured: () => false }),
        false,
      );
      assert.equal(sends, 0);
      for (let attempt = 1; attempt <= 8; attempt++) {
        assert.equal(await dispatchNextEmail(db, mailer), true);
        const {
          rows: [job],
        } = await db.query(
          "SELECT status,attempts,lease,lease_until,next_attempt_at > now() AS delayed FROM notification_emails",
        );
        assert.equal(job.attempts, attempt);
        assert.equal(job.status, attempt === 8 ? "FAILED" : "QUEUED");
        assert.equal(job.lease, null);
        assert.equal(job.lease_until, null);
        assert.equal(job.delayed, true);
        await db.query("UPDATE notification_emails SET next_attempt_at=now()");
      }
      assert.equal(await dispatchNextEmail(db, mailer), false);
      assert.equal(sends, 8);
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  },
);

test(
  "independent email workers cannot send the same active lease",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const pool = new Pool({ connectionString: databaseUrl });
    const schema = "wok_mail_" + randomUUID().replaceAll("-", "");
    const first = await pool.connect();
    const second = await pool.connect();
    let releaseSend!: () => void;
    let sendStarted!: () => void;
    const ready = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let firstWork: Promise<boolean> | undefined;
    let sends = 0;
    const mailer = {
      configured: () => true,
      send: async () => {
        sends++;
        sendStarted();
        await release;
      },
    };
    try {
      await first.query(`CREATE SCHEMA ${schema}`);
      await first.query(
        `CREATE TABLE ${schema}.notification_emails (LIKE public.notification_emails INCLUDING ALL)`,
      );
      await first.query(`SET search_path TO ${schema}, public`);
      await second.query(`SET search_path TO ${schema}, public`);
      await first.query(
        "INSERT INTO notification_emails(recipient,subject,body,status) VALUES ('test@example.invalid','Synthetic concurrent worker','Synthetic body','QUEUED')",
      );
      firstWork = dispatchNextEmail(first, mailer);
      await ready;
      assert.equal(await dispatchNextEmail(second, mailer), false);
      assert.equal(sends, 1);
      releaseSend();
      assert.equal(await firstWork, true);
      assert.equal(
        (await second.query("SELECT status,attempts FROM notification_emails"))
          .rows[0].status,
        "SENT",
      );
      assert.equal(await dispatchNextEmail(second, mailer), false);
    } finally {
      releaseSend();
      await firstWork;
      await first.query("SET search_path TO public");
      await second.query("SET search_path TO public");
      await first.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      first.release();
      second.release();
      await pool.end();
    }
  },
);
