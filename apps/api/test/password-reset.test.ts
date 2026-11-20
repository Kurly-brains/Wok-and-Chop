import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import type { EmailMessage } from "../src/notifications";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";
const currentPassword = "Synthetic existing password!";
const newPassword = "Synthetic replacement password!";
const validFormatWrongCode = (code: string) =>
  code === "000000" ? "999999" : "000000";

test(
  "email password reset is private, throttled, single-use and revokes existing sessions",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error(
        "Password-reset integration tests require the dedicated test database.",
      );
    const pool = new Pool({ connectionString: databaseUrl });
    const email = `reset-${randomUUID()}@example.invalid`;
    const unknownAddress = `reset-${randomUUID()}@example.invalid`;
    const messages: EmailMessage[] = [];
    let enabled = true;
    const app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
      mailer: {
        configured: () => enabled,
        send: async (message) => {
          messages.push(message);
        },
      },
    });

    try {
      await app.listen(0, "127.0.0.1");
      const base = (await app.getUrl()) + "/v1/auth";
      const post = (path: string, body: unknown, requestOrigin = origin) =>
        fetch(base + "/" + path, {
          method: "POST",
          headers: {
            Origin: requestOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      const request = () =>
        post("password-reset/request", { email: email.toUpperCase() });
      const confirm = (code: string, address = email, password = newPassword) =>
        post("password-reset/confirm", { email: address, code, password });
      const codeFromLastMessage = () => {
        const message = messages.at(-1);
        assert.equal(message?.to, email);
        return (
          message?.text.match(/\b\d{6}\b/)?.[0] ??
          assert.fail("No verification code in email fixture.")
        );
      };
      const register = await post("register", {
        email,
        name: "Reset fixture",
        password: currentPassword,
      });
      assert.equal(register.status, 201);
      const { user } = await register.json();
      const initialCookie =
        register.headers.get("set-cookie")?.split(";")[0] ??
        assert.fail("Missing session cookie.");

      assert.equal(
        (
          await post(
            "password-reset/request",
            { email },
            "https://untrusted.example",
          )
        ).status,
        403,
      );
      enabled = false;
      assert.equal((await request()).status, 503);
      enabled = true;

      const [known, unknown] = await Promise.all([
        request(),
        post("password-reset/request", { email: unknownAddress }),
      ]);
      assert.equal(known.status, 202);
      assert.equal(unknown.status, 202);
      assert.equal(known.headers.get("cache-control"), "no-store");
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal(messages.length, 1);
      const firstCode = codeFromLastMessage();
      const stored = (
        await pool.query(
          "SELECT encode(code_digest,'hex') AS digest, attempts FROM customer_password_resets WHERE account_id=$1",
          [user.id],
        )
      ).rows[0];
      assert.match(stored.digest, /^[0-9a-f]{64}$/);
      assert.equal(stored.attempts, 0);
      assert.equal((await request()).status, 202);
      assert.equal(messages.length, 1);
      assert.equal((await confirm(firstCode, email, "too short")).status, 400);

      const fakeCode = validFormatWrongCode(firstCode);
      const unknownConfirm = await confirm(fakeCode, unknownAddress);
      assert.equal(unknownConfirm.status, 400);
      const error = await unknownConfirm.json();
      for (let attempt = 0; attempt < 5; attempt++) {
        const wrong = await confirm(fakeCode);
        assert.equal(wrong.status, 400);
        assert.deepEqual(await wrong.json(), error);
      }
      assert.equal((await confirm(firstCode)).status, 400);

      // Move the first fixture beyond expiry and resend cooldown without delaying the suite.
      await pool.query(
        `UPDATE customer_password_resets SET
        requested_at=now() - interval '11 minutes',
        expires_at=now() - interval '1 minute',
        window_started_at=now() - interval '11 minutes',
        attempts=0 WHERE account_id=$1`,
        [user.id],
      );
      assert.equal((await confirm(firstCode)).status, 400);
      assert.equal((await request()).status, 202);
      assert.equal(messages.length, 2);
      const code = codeFromLastMessage();
      const results = await Promise.all([confirm(code), confirm(code)]);
      assert.deepEqual(
        results.map((response) => response.status).sort(),
        [200, 400],
      );
      assert.equal((await confirm(code)).status, 400);
      assert.equal(
        (await post("login", { email, password: currentPassword })).status,
        401,
      );
      assert.equal(
        (await post("login", { email, password: newPassword })).status,
        200,
      );

      const me = await fetch(base + "/me", {
        headers: { Cookie: initialCookie },
      });
      assert.deepEqual(await me.json(), { user: null });
      assert.match(me.headers.get("set-cookie") ?? "", /Max-Age=0/);

      const elapseCooldown = () =>
        pool.query(
          "UPDATE customer_password_resets SET requested_at=now() - interval '61 seconds' WHERE account_id=$1",
          [user.id],
        );
      await elapseCooldown();
      assert.equal((await request()).status, 202);
      assert.equal(messages.length, 3);
      await elapseCooldown();
      assert.equal((await request()).status, 202);
      assert.equal(messages.length, 3);
    } finally {
      await pool.query(
        "DELETE FROM customer_accounts WHERE email_normalized=$1",
        [email],
      );
      await app.close();
      await pool.end();
    }
  },
);
