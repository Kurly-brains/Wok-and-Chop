import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { fetchCustomerOrders } from "../src/customer-orders";

const connectionString = process.env.AUTH_TEST_DATABASE_URL;
test(
  "order history isolates ownership, projects the active receipt and walks pages without duplicates",
  { skip: !connectionString },
  async () => {
    if (new URL(connectionString!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated account test database required.");
    const pool = new Pool({ connectionString });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = randomUUID(),
        other = randomUUID(),
        location = randomUUID();
      for (const id of [owner, other]) {
        await client.query(
          "INSERT INTO customer_accounts(id, display_name, email_normalized, password_hash) VALUES($1,'Fixture',$2,'unusable fixture')",
          [id, `${id}@example.invalid`],
        );
      }
      await client.query(
        "INSERT INTO locations(id,name,address) VALUES($1,'History fixture','Test address')",
        [location],
      );
      const line = {
        name: "Fixture dish",
        quantity: 2,
        modifiers: [{ id: "private-id", name: "Dry", priceCents: 0 }],
        lineTotalCents: 1500,
        note: "private kitchen note",
      };
      const ids: string[] = [];
      for (let i = 1; i <= 14; i++) {
        const id = randomUUID();
        ids.push(id);
        await client.query(
          `INSERT INTO orders(id, location_id, business_date, display_number, customer_account_id, created_at)
        VALUES($1,$2,'2026-11-18',$3::bigint,$4,'2026-11-18T12:00Z'::timestamptz + $3::bigint * interval '1 second')`,
          [id, location, i, i === 14 ? null : i === 13 ? other : owner],
        );
        await client.query(
          `INSERT INTO order_revisions(order_id,revision,total_cents,lines,tax_snapshot,pricing_snapshot,menu_version)
        VALUES($1,1,1500,$2,'{}','{}','test')`,
          [id, JSON.stringify([line])],
        );
      }
      await client.query(
        `INSERT INTO order_revisions(order_id,revision,total_cents,lines,tax_snapshot,pricing_snapshot,menu_version)
      VALUES($1,2,1600,$2,'{}','{}','test')`,
        [
          ids[11],
          JSON.stringify([
            { ...line, name: "Revised dish", lineTotalCents: 1600 },
          ]),
        ],
      );
      await client.query("UPDATE orders SET active_revision=2 WHERE id=$1", [
        ids[11],
      ]);
      const first = await fetchCustomerOrders(client, owner);
      assert.equal(first.orders.length, 10);
      const newest = first.orders[0];
      assert.equal(newest.id, ids[11]);
      assert.equal(newest.totalCents, 1600);
      assert.deepEqual(newest.items, [
        {
          name: "Revised dish",
          quantity: 2,
          modifiers: ["Dry"],
          lineTotalCents: 1600,
        },
      ]);
      assert.ok(!JSON.stringify(first).includes("private"));
      const second = await fetchCustomerOrders(client, owner, first.nextCursor);
      assert.deepEqual(
        [...first.orders, ...second.orders].map((order) => order.id),
        ids.slice(0, 12).reverse(),
      );
      assert.equal(second.nextCursor, null);
      assert.deepEqual(
        (await fetchCustomerOrders(client, other)).orders.map(
          (order) => order.id,
        ),
        [ids[12]],
      );
      assert.deepEqual(
        (await fetchCustomerOrders(client, other, ids[11])).orders,
        [],
      );
      await assert.rejects(() =>
        fetchCustomerOrders(client, owner, "invalid cursor"),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);
