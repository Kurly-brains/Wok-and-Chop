import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import {
  postalPrefixes,
  prepareQuote,
  quoteInput,
} from "../src/delivery-input";

const origin = "http://127.0.0.1:3000";
const lines = [
  {
    itemId: "lunch-chilli-chicken",
    quantity: 2,
    modifierIds: ["lunch-jasmine-rice", "lunch-soup-of-day", "lunch-dry"],
    note: "Synthetic private note",
  },
];
const basket = { lines, postalCode: "K2K 1X1", promoCode: "WOK10" };
const address = {
  street: "42 Test Lane",
  city: "Kanata",
  province: "ON",
  postalCode: basket.postalCode,
  unit: "7",
};
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;

test("local zones accept configured Ontario prefixes and reject unverified cart amounts", () => {
  const prior = process.env.DELIVERY_POSTAL_PREFIXES;
  try {
    process.env.DELIVERY_POSTAL_PREFIXES = "k2k,k2t";
    assert.deepEqual(postalPrefixes(), ["K2K", "K2T"]);
    assert.equal(prepareQuote(quoteInput(basket)).totals.totalCents, 2698);
    assert.throws(
      () => prepareQuote(quoteInput({ ...basket, postalCode: "K1A 0A9" })),
      /outside/,
    );
    assert.throws(
      () => quoteInput({ ...basket, postalCode: "V6B 1A1" }),
      /Ontario/,
    );
    assert.throws(() => quoteInput({ ...basket, totalCents: 1 }), /Unexpected/);
    assert.throws(
      () => quoteInput({ ...basket, lines: [{ ...lines[0], priceCents: 1 }] }),
      /unsupported/,
    );
    assert.throws(
      () =>
        prepareQuote(
          quoteInput({ ...basket, lines: [{ ...lines[0], modifierIds: [] }] }),
        ),
      /choose/i,
    );
  } finally {
    if (prior === undefined) delete process.env.DELIVERY_POSTAL_PREFIXES;
    else process.env.DELIVERY_POSTAL_PREFIXES = prior;
  }
});

test(
  "local unpaid deliveries persist, replay safely, isolate customers and use authorized versioned dispatch",
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
    const keys: string[] = [];
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
      assert.equal(config.mode, "LOCAL_UNPAID");
      assert.equal(config.deliveryCents, null);
      const quoted = await post("deliveries/quote", basket);
      assert.equal(quoted.status, 200);
      const quote = await quoted.json();
      assert.equal(quote.subtotalCents, 2998);
      assert.equal(quote.discountCents, 300);
      assert.equal(quote.totalCents, 2698);
      assert.equal(quote.items[0].name, "Chilli Chicken");
      assert.equal(quote.taxCents, null);
      const input = {
        requestId: randomUUID(),
        lines,
        promoCode: basket.promoCode,
        name: "Synthetic Recipient",
        phone: "613-555-0108",
        address,
        instructions: "Synthetic private directions",
        quoteFingerprint: quote.quoteFingerprint,
        expectedTotalCents: 2698,
      };
      keys.push(input.requestId);
      assert.equal(
        (await post("deliveries", { ...input, expectedTotalCents: 1 })).status,
        409,
      );
      assert.equal(
        (await post("deliveries", { ...input, trackingToken: "x" })).status,
        400,
      );
      assert.equal(
        (
          await post("deliveries", {
            ...input,
            address: { ...address, province: "QC" },
          })
        ).status,
        400,
      );
      const pair = await Promise.all([
        post("deliveries", input),
        post("deliveries", input),
      ]);
      assert.deepEqual(
        pair.map((r) => r.status),
        [201, 201],
      );
      const first = await pair[0].json(),
        again = await pair[1].json();
      assert.deepEqual(first, again);
      assert.match(first.trackingToken, /^[\da-f]{64}$/);
      assert.equal(first.delivery.status, "RECEIVED");
      assert.equal(first.delivery.version, 1);
      assert.equal(JSON.stringify(first).includes("Synthetic"), false);
      assert.equal(
        (await post("deliveries", { ...input, name: "different" })).status,
        409,
      );
      assert.equal((await post("deliveries", input, owner.cookie)).status, 409);
      const ownKey = randomUUID();
      keys.push(ownKey);
      const own = await (
        await post("deliveries", { ...input, requestId: ownKey }, owner.cookie)
      ).json();
      const mine = await (await get("deliveries/mine", owner.cookie)).json();
      assert.deepEqual(
        mine.deliveries.map((order: { id: string }) => order.id),
        [own.delivery.id],
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
      assert.equal(
        JSON.stringify(await track.json()).includes("Synthetic"),
        false,
      );
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
      // Key-scoped cleanup also catches an assertion failure immediately after creation.
      if (keys.length)
        await db.query(
          "DELETE FROM delivery_orders WHERE request_hash IN (SELECT encode(sha256(convert_to(value,'UTF8')),'hex') FROM unnest($1::text[]) AS keys(value))",
          [keys],
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
