import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import {
  hash,
  preparePickupQuote,
  pickupQuoteInput,
} from "../src/order-input";

const origin = "http://127.0.0.1:3000";
const lines = [
  {
    itemId: "lunch-chilli-chicken",
    quantity: 2,
    modifierIds: ["lunch-jasmine-rice", "lunch-soup-of-day", "lunch-dry"],
    note: "Synthetic private note",
  },
];
const basket = { lines, promoCode: "WOK10" };
const address = {
  street: "42 Test Lane",
  city: "Kanata",
  province: "ON",
  postalCode: "K2K 1X1",
  unit: "7",
};
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

test("pickup quotes price the current catalog without accepting address or unverified cart amounts", () => {
  const quote = preparePickupQuote(pickupQuoteInput(basket));
  assert.equal(quote.totals.totalCents, 2698);
  assert.equal(quote.totals.taxCents, null);
  assert.throws(() => pickupQuoteInput({ ...basket, address }), /Unexpected/);
  assert.throws(() => pickupQuoteInput({ ...basket, totalCents: 1 }), /Unexpected/);
  assert.throws(
    () => pickupQuoteInput({ ...basket, lines: [{ ...lines[0], priceCents: 1 }] }),
    /unsupported/,
  );
  assert.throws(
    () => preparePickupQuote(pickupQuoteInput({ ...basket, lines: [{ ...lines[0], modifierIds: [] }] })),
    /choose/i,
  );
});

test(
  "existing deliveries retain private tracking, reordering and manager dispatch after switching to Uber Eats",
  { skip: !databaseUrl },
  async () => {
    if (new URL(databaseUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const app = await createApplication({
      authDatabaseUrl: databaseUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
    });
    const db = new Pool({ connectionString: databaseUrl });
    const emails: string[] = [];
    const fixtureIds: string[] = [];
    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const post = (path: string, body: unknown, cookie?: string) =>
        fetch(base + "/v1/auth/" + path, {
          method: "POST",
          headers: {
            Origin: origin,
            "content-type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        });
      const get = (path: string, cookie?: string) =>
        fetch(base + "/v1/auth/" + path, {
          headers: cookie ? { Cookie: cookie } : {},
        });
      const register = async () => {
        const email = `delivery-${randomUUID()}@example.invalid`;
        emails.push(email);
        const signed = await post("register", {
          name: "Delivery fixture",
          email,
          password: "Synthetic test password!",
        });
        assert.equal(signed.status, 201);
        return {
          user: (await signed.json()).user,
          cookie: signed.headers.get("set-cookie")!.split(";")[0],
        };
      };
      const owner = await register(),
        manager = await register();
      await db.query("INSERT INTO restaurant_managers(account_id) VALUES($1)", [
        manager.user.id,
      ]);
      const config = await (await get("deliveries/config")).json();
      assert.equal(config.enabled, false);
      const quoted = await post("deliveries/quote", basket);
      assert.equal(quoted.status, 503);
      assert.match((await quoted.json()).message, /Uber Eats/);
      assert.equal((await post("deliveries", {})).status, 503);
      const quote = preparePickupQuote(pickupQuoteInput(basket));
      const snapshot = {
        ...quote.totals,
        lines: quote.lines,
        promoCode: basket.promoCode,
        name: "Synthetic Recipient",
        phone: "613-555-0108",
        address,
        instructions: "Synthetic private directions",
      };
      async function seedDelivery(accountId: string | null) {
        const key = randomUUID();
        const trackingToken = hash("delivery-tracking-v1:" + key);
        const { rows: [record] } = await db.query<{ id: string; order_number: string; created_at: Date }>(
          `INSERT INTO delivery_orders(customer_account_id,request_hash,request_fingerprint,tracking_hash,snapshot)
           VALUES($1,$2,$3,$4,$5) RETURNING id,order_number,created_at`,
          [accountId, hash(key), hash(key), hash(trackingToken), snapshot],
        );
        fixtureIds.push(record.id);
        await db.query(
          "INSERT INTO delivery_order_events(order_id,version,status,created_at) VALUES($1,1,'RECEIVED',$2)",
          [record.id, record.created_at],
        );
        return { delivery: { id: record.id, number: "D-" + record.order_number }, trackingToken };
      }
      const first = await seedDelivery(null);
      const own = await seedDelivery(owner.user.id);
      const mine = await (await get("deliveries/mine", owner.cookie)).json();
      assert.deepEqual(
        mine.deliveries.map((order: { id: string }) => order.id),
        [own.delivery.id],
      );
      const reorderPath = `deliveries/${own.delivery.id}/reorder`;
      const reorder = await get(reorderPath, owner.cookie);
      assert.equal(reorder.status, 200);
      assert.equal(reorder.headers.get("cache-control"), "no-store");
      assert.deepEqual(await reorder.json(), {
        accountId: owner.user.id,
        selections: lines.map(({ itemId, quantity, modifierIds }) => ({
          itemId,
          quantity,
          modifierIds: [...modifierIds].sort(),
        })),
        unavailable: 0,
      });
      assert.equal((await get(reorderPath)).status, 401);
      assert.equal((await get(reorderPath, manager.cookie)).status, 404);
      assert.equal(
        (await get(`deliveries/${first.delivery.id}/reorder`, owner.cookie)).status,
        404,
      );
      assert.equal((await get("deliveries/mine")).status, 401);
      assert.deepEqual(
        (await (await get("deliveries/mine", manager.cookie)).json())
          .deliveries,
        [],
      );
      const track = await post("deliveries/track", {
        number: first.delivery.number,
        trackingToken: first.trackingToken,
      });
      assert.equal(track.status, 200);
      assert.equal(track.headers.get("cache-control"), "no-store");
      const tracked = (await track.json()).delivery;
      assert.equal(JSON.stringify(tracked).includes("Synthetic"), false);
      assert.equal(tracked.statusHistory.length, 1);
      assert.deepEqual(Object.keys(tracked.statusHistory[0]).sort(), ["at", "status"]);
      assert.equal(tracked.statusHistory[0].status, "RECEIVED");
      assert.equal(Date.parse(tracked.statusHistory[0].at), Date.parse(tracked.createdAt));
      assert.equal(
        (
          await post("deliveries/track", {
            number: first.delivery.number,
            trackingToken: "0".repeat(64),
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await post("deliveries/track", {
            number: own.delivery.number,
            trackingToken: first.trackingToken,
          })
        ).status,
        404,
      );
      assert.equal((await get("admin/deliveries")).status, 401);
      assert.equal((await get("admin/deliveries", owner.cookie)).status, 403);
      assert.equal((await get("admin/delivery-reports")).status, 401);
      assert.equal((await get("admin/delivery-reports", owner.cookie)).status, 403);
      assert.equal((await get("admin/delivery-reports?days=60", manager.cookie)).status, 400);
      const managerList = await (
        await get("admin/deliveries?scope=active", manager.cookie)
      ).json();
      const ticket = managerList.deliveries.find(
        (d: { id: string }) => d.id === first.delivery.id,
      );
      assert.deepEqual(ticket.address, address);
      assert.equal(ticket.items[0].note, lines[0].note);
      const endpoint = `admin/deliveries/${first.delivery.id}/status`;
      assert.equal(
        (
          await post(
            endpoint,
            { expectedVersion: 1, status: "DELIVERED" },
            manager.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await post(
            endpoint,
            { expectedVersion: 1, status: "PREPARING" },
            owner.cookie,
          )
        ).status,
        403,
      );
      const race = await Promise.all([
        post(
          endpoint,
          { expectedVersion: 1, status: "PREPARING" },
          manager.cookie,
        ),
        post(
          endpoint,
          { expectedVersion: 1, status: "PREPARING" },
          manager.cookie,
        ),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      const preparing = await (
        await post("deliveries/track", { trackingToken: first.trackingToken })
      ).json();
      assert.deepEqual(
        preparing.delivery.statusHistory.map(({ status, at }: { status: string; at: string }) => [status, Number.isFinite(Date.parse(at))]),
        [["RECEIVED", true], ["PREPARING", true]],
      );
      assert.ok(!JSON.stringify(preparing).includes(manager.user.id));
      assert.equal(
        (
          await post(
            endpoint,
            { expectedVersion: 2, status: "OUT_FOR_DELIVERY" },
            manager.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await post(
            endpoint,
            { expectedVersion: 3, status: "DELIVERED" },
            manager.cookie,
          )
        ).status,
        200,
      );
      const reportResponse = await get("admin/delivery-reports?days=30", manager.cookie);
      assert.equal(reportResponse.status, 200);
      assert.equal(reportResponse.headers.get("cache-control"), "no-store");
      const report = await reportResponse.json();
      assert.match(report.startDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(report.requests >= 2);
      assert.ok(report.delivered >= 1);
      assert.ok(report.foodTotalCents >= 2698);
      assert.ok(report.dishes.some((dish: { name: string; quantity: number }) => dish.name === "Chilli Chicken" && dish.quantity >= 2));
      assert.ok(report.promos.some((promo: { code: string; discountCents: number }) => promo.code === "WOK10" && promo.discountCents >= 300));
      assert.ok(report.hours.length);
      assert.ok(Number.isFinite(report.prepMinutes));
      assert.ok(Number.isFinite(report.deliveryMinutes));
      assert.doesNotMatch(JSON.stringify(report), /Synthetic|trackingToken|Test Lane/);
      const latest = (
        await (
          await post("deliveries/track", { trackingToken: first.trackingToken })
        ).json()
      ).delivery;
      assert.equal(latest.status, "DELIVERED");
      const archived = await (
        await get("admin/deliveries?scope=history", manager.cookie)
      ).json();
      assert.ok(
        archived.deliveries.some(
          (row: { id: string }) => row.id === first.delivery.id,
        ),
      );
      const audit = await db.query(
        "SELECT status,manager_id FROM delivery_order_events WHERE order_id=$1 ORDER BY version",
        [latest.id],
      );
      assert.deepEqual(
        audit.rows.map((r) => r.status),
        ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"],
      );
      assert.equal(audit.rows[3].manager_id, manager.user.id);
      await assert.rejects(
        db.query("UPDATE delivery_orders SET snapshot='{}' WHERE id=$1", [
          latest.id,
        ]),
        /immutable/,
      );
    } finally {
      if (fixtureIds.length)
        await db.query(
          "DELETE FROM delivery_orders WHERE id=ANY($1::uuid[])",
          [fixtureIds],
        );
      if (emails.length)
        await db.query(
          "DELETE FROM customer_accounts WHERE email_normalized=ANY($1::text[])",
          [emails],
        );
      await app.close();
      await db.end();
    }
  },
);
