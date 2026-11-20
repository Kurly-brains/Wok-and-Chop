import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { hash } from "../src/order-input";
import { staffEmail } from "../src/notifications";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";
const lines = [
  {
    itemId: "lunch-chilli-chicken",
    quantity: 2,
    modifierIds: ["lunch-jasmine-rice", "lunch-soup-of-day", "lunch-dry"],
    note: "Synthetic kitchen note",
  },
];

test(
  "direct pickup uses a server-priced checkout and stays private through collection",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const db = new Pool({ connectionString: databaseUrl });
    const app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
    });
    const emails: string[] = [];
    const requestHashes: string[] = [];
    const notificationSubjects: string[] = [];
    try {
      await app.listen(0, "127.0.0.1");
      const base = `${await app.getUrl()}/v1/auth/`;
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
      async function register() {
        const email = `pickup-${randomUUID()}@example.invalid`;
        emails.push(email);
        const response = await post("register", {
          name: "Synthetic test account",
          email,
          password: "Synthetic test password!",
        });
        assert.equal(response.status, 201);
        return {
          id: (await response.json()).user.id,
          cookie: response.headers.get("set-cookie")!.split(";")[0],
        };
      }
      const owner = await register();
      const manager = await register();
      await db.query("INSERT INTO restaurant_managers(account_id) VALUES($1)", [
        manager.id,
      ]);
      const config = await get("pickups/config");
      assert.equal(config.status, 200);
      assert.deepEqual(await config.json(), {
        enabled: true,
        mode: "LOCAL_UNPAID",
        deliveryCents: null,
        taxCents: null,
      });

      const basket = { lines, promoCode: "WOK10" };
      assert.equal(
        (
          await post(
            "pickups/quote",
            basket,
            undefined,
            "http://unauthorized.example.invalid",
          )
        ).status,
        403,
      );
      const quoted = await post("pickups/quote", basket);
      assert.equal(quoted.status, 200);
      const { quoteFingerprint, totalCents, subtotalCents, discountCents } =
        await quoted.json();
      assert.match(quoteFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(totalCents, 2698);
      assert.equal(subtotalCents - discountCents, totalCents);

      function requestBody() {
        const requestId = randomUUID();
        requestHashes.push(hash("pickup-request-v1:" + requestId));
        return {
          ...basket,
          requestId,
          name: "Synthetic Pickup Guest",
          phone: "613-555-0108",
          quoteFingerprint,
          expectedTotalCents: totalCents,
        };
      }
      const pickupEmail = `updates-${randomUUID()}@example.invalid`;
      emails.push(pickupEmail);
      const request = {
        ...requestBody(),
        email: pickupEmail,
        expectedAccountId: null,
      };
      const signedOutAfterReview = await post("pickups", {
        ...request,
        expectedAccountId: owner.id,
      });
      assert.equal(signedOutAfterReview.status, 409);
      assert.equal(
        (await signedOutAfterReview.json()).code,
        "CHECKOUT_ACCOUNT_CHANGED",
      );
      const signedInAfterGuestReview = await post(
        "pickups",
        request,
        owner.cookie,
      );
      assert.equal(signedInAfterGuestReview.status, 409);
      assert.equal(
        (await signedInAfterGuestReview.json()).code,
        "CHECKOUT_ACCOUNT_CHANGED",
      );
      const switchedAccounts = await post(
        "pickups",
        { ...request, expectedAccountId: owner.id },
        manager.cookie,
      );
      assert.equal(switchedAccounts.status, 409);
      assert.equal(
        (await switchedAccounts.json()).code,
        "CHECKOUT_ACCOUNT_CHANGED",
      );
      assert.equal(
        (
          await post("pickups", {
            ...request,
            expectedAccountId: { id: owner.id },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM delivery_orders WHERE request_hash=$1",
            [requestHashes.at(-1)],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (await post("pickups", { ...request, expectedTotalCents: 1 })).status,
        409,
      );
      assert.equal(
        (await post("pickups", { ...request, address: "Test address" })).status,
        400,
      );
      assert.equal(
        (await post("pickups", { ...request, phone: "incorrect" })).status,
        400,
      );
      const attempts = await Promise.all([
        post("pickups", request),
        post("pickups", request),
      ]);
      assert.deepEqual(
        attempts.map(({ status }) => status),
        [201, 201],
      );
      const [guest, replay] = await Promise.all(
        attempts.map((response) => response.json()),
      );
      notificationSubjects.push(`New Wok & Chop pickup ${guest.pickup.number}`);
      assert.deepEqual(guest, replay);
      assert.match(guest.pickup.number, /^P-\d+$/);
      assert.match(guest.trackingToken, /^[a-f0-9]{64}$/);
      assert.equal(guest.pickup.status, "RECEIVED");
      assert.deepEqual(
        guest.pickup.statusHistory.map(
          (event: { status: string }) => event.status,
        ),
        ["RECEIVED"],
      );
      assert.ok(Number.isFinite(Date.parse(guest.pickup.statusHistory[0].at)));
      assert.equal(guest.pickup.totalCents, totalCents);
      assert.equal(guest.pickup.deliveryCents, null);
      assert.equal(guest.pickup.taxCents, null);
      assert.equal(
        (await post("pickups", { ...request, name: "Different contact" }))
          .status,
        409,
      );
      assert.equal((await post("pickups", request, owner.cookie)).status, 409);

      const legacySignedInRequest = requestBody();
      const signedInOrder = await post(
        "pickups",
        legacySignedInRequest,
        owner.cookie,
      );
      assert.equal(signedInOrder.status, 201);
      const signedIn = await signedInOrder.json();
      const guardedRetry = await post(
        "pickups",
        { ...legacySignedInRequest, expectedAccountId: owner.id },
        owner.cookie,
      );
      assert.equal(guardedRetry.status, 201);
      assert.deepEqual(await guardedRetry.json(), signedIn);
      const omittedGuestGuard = { ...request, expectedAccountId: undefined };
      assert.deepEqual(
        await (await post("pickups", omittedGuestGuard)).json(),
        guest,
      );
      notificationSubjects.push(
        `New Wok & Chop pickup ${signedIn.pickup.number}`,
      );
      assert.equal((await get("pickups/mine")).status, 401);
      const { pickups, accountId } = await (
        await get("pickups/mine", owner.cookie)
      ).json();
      assert.equal(accountId, owner.id);
      assert.deepEqual(
        pickups.map(({ id }: { id: string }) => id),
        [signedIn.pickup.id],
      );
      assert.equal(
        (await (await get("deliveries/mine", owner.cookie)).json()).deliveries
          .length,
        0,
      );
      assert.equal(
        (await (await get("pickups/mine", manager.cookie)).json()).pickups
          .length,
        0,
      );
      assert.equal((await get("admin/deliveries", owner.cookie)).status, 403);
      const queue = await (
        await get("admin/deliveries?scope=active", manager.cookie)
      ).json();
      const ticket = queue.deliveries.find(
        ({ id }: { id: string }) => id === guest.pickup.id,
      );
      assert.equal(ticket.fulfillment, "PICKUP");
      assert.equal(ticket.name, request.name);
      assert.equal(ticket.address, null);
      assert.equal(ticket.items[0].note, lines[0].note);

      const statusPath = `admin/deliveries/${guest.pickup.id}/status`;
      assert.equal(
        (
          await post(
            statusPath,
            { status: "OUT_FOR_DELIVERY", expectedVersion: 1 },
            manager.cookie,
          )
        ).status,
        409,
      );
      for (const [index, status] of [
        "PREPARING",
        "READY_FOR_PICKUP",
        "PICKED_UP",
      ].entries()) {
        const updated = await post(
          statusPath,
          { status, expectedVersion: index + 1 },
          manager.cookie,
        );
        assert.equal(updated.status, 200);
        assert.equal((await updated.json()).delivery.status, status);
      }
      assert.equal(
        (
          await post(
            statusPath,
            { status: "CANCELLED", expectedVersion: 4 },
            manager.cookie,
          )
        ).status,
        409,
      );
      const history = await (
        await get("admin/deliveries?scope=history", manager.cookie)
      ).json();
      assert.ok(
        history.deliveries.some(
          ({ id }: { id: string }) => id === guest.pickup.id,
        ),
      );

      const track = await post("pickups/track", {
        trackingToken: guest.trackingToken,
        number: guest.pickup.number,
      });
      assert.equal(track.status, 200);
      assert.equal(track.headers.get("cache-control"), "no-store");
      const tracked = (await track.json()).pickup;
      assert.deepEqual(
        tracked.statusHistory.map(({ status }: { status: string }) => status),
        ["RECEIVED", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP"],
      );
      const laterReplay = await post("pickups", request);
      assert.equal(laterReplay.status, 201);
      const replayedReceipt = await laterReplay.json();
      assert.deepEqual(replayedReceipt.pickup, tracked);
      assert.equal(replayedReceipt.trackingToken, guest.trackingToken);
      assert.doesNotMatch(
        JSON.stringify(tracked),
        /Synthetic|555-0108|trackingToken|example\.invalid/,
      );
      const notifications = await db.query<{
        recipient: string;
        subject: string;
        body: string;
      }>(
        `SELECT recipient, subject, body FROM notification_emails
         WHERE recipient=$1 OR subject=ANY($2::text[]) ORDER BY created_at`,
        [pickupEmail, notificationSubjects],
      );
      assert.equal(
        notifications.rows.filter((row) => row.recipient === staffEmail).length,
        2,
      );
      const customerEmails = notifications.rows.filter(
        (row) => row.recipient === pickupEmail,
      );
      assert.equal(customerEmails.length, 4);
      assert.ok(
        customerEmails.some((row) => row.subject.includes("Ready to collect")),
      );
      assert.ok(
        customerEmails.every((row) => !row.body.includes(guest.trackingToken)),
      );
      assert.equal(
        (
          await post("pickups/track", {
            trackingToken: guest.trackingToken,
            number: signedIn.pickup.number,
          })
        ).status,
        404,
      );
      assert.equal(
        (await post("deliveries/track", { trackingToken: guest.trackingToken }))
          .status,
        404,
      );
      await assert.rejects(
        db.query(
          "UPDATE delivery_orders SET fulfillment='DELIVERY' WHERE id=$1",
          [signedIn.pickup.id],
        ),
        /immutable/,
      );
    } finally {
      await db.query(
        "DELETE FROM notification_emails WHERE recipient=ANY($1::text[]) OR subject=ANY($2::text[])",
        [emails, notificationSubjects],
      );
      await db.query(
        "DELETE FROM delivery_orders WHERE request_hash=ANY($1::text[])",
        [requestHashes],
      );
      await db.query(
        "DELETE FROM customer_accounts WHERE email_normalized=ANY($1::text[])",
        [emails],
      );
      await app.close();
      await db.end();
    }
  },
);
