import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import {
  createWindowsPrinterAdapter,
  type WindowsPrinterAdapter,
  type WindowsPrintOutcome,
} from "../../print-bridge/windows-printer";
import { hash } from "../src/order-input";

test("Windows printer adapter requires an explicit installed queue and preserves uncertainty", async () => {
  let calls = 0;
  const unconfigured = createWindowsPrinterAdapter({
    queueName: () => undefined,
    platform: "win32",
    runner: async () => {
      calls++;
      return {};
    },
  });
  assert.equal((await unconfigured.status()).ready, false);
  assert.equal(calls, 0);
  const unsupported = createWindowsPrinterAdapter({
    queueName: () => "Synthetic USB",
    platform: "linux",
    runner: async () => {
      calls++;
      return {};
    },
  });
  assert.equal((await unsupported.status()).ready, false);
  assert.equal(calls, 0);
  let outcome = "SPOOLED";
  const queueName = "Synthetic queue ' $(not-a-command)";
  const adapter = createWindowsPrinterAdapter({
    queueName: () => queueName,
    platform: "win32",
    runner: async (request) => {
      calls++;
      assert.equal(request.queueName, queueName);
      if (request.operation === "status") return { available: true };
      if (outcome === "throw")
        throw new Error("Synthetic missing acknowledgement");
      return { status: outcome };
    },
  });
  const ready = await adapter.status();
  assert.equal(ready.ready, true);
  assert.equal(ready.physicalOutputVerified, false);
  const job = { id: randomUUID(), queueName, text: "Synthetic test" };
  assert.equal((await adapter.send(job)).status, "SPOOLED");
  outcome = "FAILED";
  assert.equal((await adapter.send(job)).status, "FAILED");
  outcome = "throw";
  assert.equal((await adapter.send(job)).status, "UNKNOWN");
  const beforeChangedQueue = calls;
  assert.equal(
    (await adapter.send({ ...job, queueName: "Unapproved default" })).status,
    "FAILED",
  );
  assert.equal(calls, beforeChangedQueue);
});

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";
test(
  "manager Windows printing journals one authoritative pickup ticket and never resends ambiguous jobs",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const pool = new Pool({ connectionString: databaseUrl });
    const email = `windows-print-${randomUUID()}@example.invalid`;
    const queueName = "Synthetic Windows queue " + randomUUID();
    const sends: { id: string; queueName: string; text: string }[] = [];
    let available = true;
    let nextOutcome: WindowsPrintOutcome["status"] = "SPOOLED";
    let resolveStarted!: () => void;
    let releaseSend!: () => void;
    let hold = false;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const adapter: WindowsPrinterAdapter = {
      status: async () => ({
        mode: "WINDOWS_QUEUE",
        configured: true,
        queueName,
        available,
        ready: available,
        physicalOutputVerified: false,
        detail: "Synthetic queue fixture",
      }),
      send: async (job) => {
        sends.push(job);
        if (hold) {
          resolveStarted();
          await release;
        }
        return { status: nextOutcome, detail: "Synthetic " + nextOutcome };
      },
    };
    const app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
      windowsPrinterAdapter: adapter,
    });
    const orderIds: string[] = [];
    const requestIds: string[] = [];
    const notificationSubjects: string[] = [];
    let accountId: string | undefined;
    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
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
      const get = (cookie?: string) =>
        fetch(base + "/v1/auth/admin/printer", {
          headers: cookie ? { Cookie: cookie } : {},
        });
      const registered = await post("/v1/auth/register", {
        name: "Synthetic printer manager",
        email,
        password: "Synthetic printer test password!",
      });
      assert.equal(registered.status, 201);
      accountId = (await registered.json()).user.id;
      const cookie = registered.headers.get("set-cookie")!.split(";")[0];
      const endpoint = "/v1/auth/admin/printer/test";
      assert.equal((await get()).status, 401);
      assert.equal((await get(cookie)).status, 403);
      assert.equal(
        (await post(endpoint, { requestId: randomUUID() }, cookie)).status,
        403,
      );
      await pool.query(
        "INSERT INTO restaurant_managers(account_id) VALUES($1)",
        [accountId],
      );
      const status = await (await get(cookie)).json();
      assert.equal(status.ready, true);
      assert.equal(status.physicalOutputVerified, false);
      assert.equal(
        (
          await post(
            endpoint,
            { requestId: randomUUID() },
            cookie,
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post(
            endpoint,
            {
              requestId: randomUUID(),
              text: "Injected bytes",
              queueName: "Other queue",
            },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(sends.length, 0);
      available = false;
      assert.equal(
        (await post(endpoint, { requestId: randomUUID() }, cookie)).status,
        503,
      );
      available = true;

      const testRequest = { requestId: randomUUID() };
      hold = true;
      const firstResponse = post(endpoint, testRequest, cookie);
      await started;
      const duplicate = await post(endpoint, testRequest, cookie);
      assert.equal(duplicate.status, 200);
      const pending = (await duplicate.json()).job;
      assert.equal(pending.status, "SENDING");
      assert.equal((await (await get(cookie)).json()).ready, false);
      assert.equal(
        (await post(endpoint, { requestId: randomUUID() }, cookie)).status,
        409,
      );
      assert.equal(sends.length, 1);
      releaseSend();
      hold = false;
      const first = await firstResponse;
      assert.equal(first.status, 200);
      const completed = (await first.json()).job;
      assert.equal(completed.id, pending.id);
      assert.equal(completed.status, "SPOOLED");
      assert.match(sends[0].text, /TEST \/ DO NOT PREPARE/);
      assert.equal(
        (await (await post(endpoint, testRequest, cookie)).json()).job.id,
        pending.id,
      );
      assert.equal(sends.length, 1);
      for (const result of ["FAILED", "UNKNOWN"] as const) {
        nextOutcome = result;
        const request = { requestId: randomUUID() };
        const sent = await post(endpoint, request, cookie);
        assert.equal(sent.status, 200);
        const sentJob = (await sent.json()).job;
        assert.equal(sentJob.status, result);
        const count = sends.length;
        assert.equal(
          (await (await post(endpoint, request, cookie)).json()).job.id,
          sentJob.id,
        );
        assert.equal(sends.length, count);
      }
      nextOutcome = "SPOOLED";
      const createPickup = async () => {
        const lines = [
          {
            itemId: "lunch-chilli-chicken",
            quantity: 2,
            modifierIds: [
              "lunch-jasmine-rice",
              "lunch-soup-of-day",
              "lunch-dry",
            ],
            note: "Synthetic allergy note: no celery",
          },
        ];
        const quote = await (
          await post("/v1/auth/pickups/quote", { lines })
        ).json();
        const requestId = randomUUID();
        requestIds.push(requestId);
        const placed = await post(
          "/v1/auth/pickups",
          {
            requestId,
            name: "Synthetic private name",
            phone: "613-555-0108",
            email,
            lines,
            quoteFingerprint: quote.quoteFingerprint,
            expectedTotalCents: quote.totalCents,
          },
          cookie,
        );
        assert.equal(placed.status, 201);
        const { pickup } = await placed.json();
        orderIds.push(pickup.id);
        notificationSubjects.push(
          `New Wok & Chop pickup ${pickup.number}`,
          `Cancelled Wok & Chop pickup ${pickup.number}`,
        );
        return pickup;
      };
      const pickup = await createPickup();
      const pickupPath = "/v1/auth/admin/printer/pickups/" + pickup.id;
      assert.equal((await post(pickupPath, testRequest, cookie)).status, 409);
      const printed = await post(
        pickupPath,
        { requestId: randomUUID() },
        cookie,
      );
      assert.equal(printed.status, 200);
      const kitchen = (await printed.json()).job;
      assert.equal(kitchen.orderId, pickup.id);
      assert.equal(kitchen.orderNumber, pickup.number);
      const ticket = sends.at(-1)!;
      assert.match(ticket.text, /UNPAID/);
      assert.match(ticket.text, /2 × Chilli Chicken/);
      assert.match(ticket.text, /no celery/);
      assert.doesNotMatch(
        ticket.text,
        /Synthetic private name|613|example\.invalid|\u001b/,
      );
      assert.equal(
        kitchen.payloadHash,
        createHash("sha256").update(ticket.text).digest("hex"),
      );
      const sendCount = sends.length;
      assert.equal(
        (
          await (
            await post(pickupPath, { requestId: randomUUID() }, cookie)
          ).json()
        ).job.id,
        kitchen.id,
      );
      assert.equal(sends.length, sendCount);
      await assert.rejects(
        pool.query(
          "UPDATE windows_print_jobs SET payload='altered' WHERE id=$1",
          [kitchen.id],
        ),
        /immutable/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE windows_print_jobs SET status='SENDING' WHERE id=$1",
          [kitchen.id],
        ),
        /cannot be resent/,
      );
      const cancelled = await createPickup();
      assert.equal(
        (
          await post(
            `/v1/auth/admin/deliveries/${cancelled.id}/status`,
            { expectedVersion: 1, status: "CANCELLED" },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await post(
            "/v1/auth/admin/printer/pickups/" + cancelled.id,
            { requestId: randomUUID() },
            cookie,
          )
        ).status,
        409,
      );
      assert.equal(sends.length, sendCount);
      const interruptedId = randomUUID();
      await pool.query(
        `INSERT INTO windows_print_jobs(id,request_hash,request_fingerprint,kind,queue_name,payload,payload_hash,status,detail,actor_id,created_at) VALUES($1,$2,$3,'TEST',$4,'Synthetic interrupted ticket',$5,'SENDING','Synthetic interruption',$6,now()-interval '3 minutes')`,
        [
          interruptedId,
          hash(randomUUID()),
          hash(randomUUID()),
          queueName,
          hash("Synthetic interrupted ticket"),
          accountId,
        ],
      );
      const recovered = await (await get(cookie)).json();
      assert.equal(
        recovered.jobs.find((job: { id: string }) => job.id === interruptedId)
          .status,
        "UNKNOWN",
      );
      assert.equal(sends.length, sendCount);
    } finally {
      releaseSend();
      await pool.query("DELETE FROM windows_print_jobs WHERE queue_name=$1", [
        queueName,
      ]);
      await pool.query(
        "DELETE FROM notification_emails WHERE recipient=$1 OR subject=ANY($2::text[])",
        [email, notificationSubjects],
      );
      await pool.query(
        "DELETE FROM delivery_orders WHERE request_hash=ANY($1::text[])",
        [requestIds.map((id) => hash("pickup-request-v1:" + id))],
      );
      await pool.query(
        "DELETE FROM customer_accounts WHERE email_normalized=$1",
        [email],
      );
      await app.close();
      await pool.end();
    }
  },
);
