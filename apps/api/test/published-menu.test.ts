import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";

const dbUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";

test("manager publishing shares a valid photo and price with the public menu and server quote", { skip: !dbUrl }, async () => {
  if (new URL(dbUrl!).pathname !== "/wok_chop_auth_test") throw new Error("Dedicated test database required");
  const app = await createApplication({ authDatabaseUrl: dbUrl, webOrigin: origin, trainingDatabasePath: ":memory:" });
  const db = new Pool({ connectionString: dbUrl });
  const item = "lunch-mongolian-beef";
  const email = `menu-${randomUUID()}@example.invalid`;
  let published = false;

  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    const current = await (await fetch(base + "/v1/menu")).json();
    assert.equal(current.overrides[item], undefined);
    const registered = await post("/v1/auth/register", { name: "Menu test manager", email, password: "Synthetic menu test password!" });
    assert.equal(registered.status, 201);
    const { user } = await registered.json();
    const cookie = registered.headers.get("set-cookie")!.split(";")[0];
    const path = "/v1/auth/admin/menu/items/" + item;
    const patch = { expectedVersion: current.version, patch: { priceCents: 1550 } };
    assert.equal((await post(path, patch)).status, 401);
    assert.equal((await post(path, patch, cookie)).status, 403);
    await db.query("INSERT INTO restaurant_managers(account_id) VALUES ($1)", [user.id]);

    const base64 = readFileSync(join(__dirname, "../../web/public/images/art/round-rosewood-table.webp")).toString("base64");
    const image = "data:image/webp;base64," + base64;
    assert.equal((await post("/v1/quotes", { image })).status, 413);
    const saved = await post(path, { ...patch, patch: { ...patch.patch, image } }, cookie);
    assert.equal(saved.status, 200);
    published = true;
    assert.equal((await post(path, patch, cookie)).status, 409);

    const updated = await (await fetch(base + "/v1/menu")).json();
    assert.equal(updated.overrides[item].priceCents, 1550);
    assert.equal(updated.overrides[item].image, image);
    const unchanged = await (await fetch(base + "/v1/menu?after=" + updated.version)).json();
    assert.equal(unchanged.overrides, null);

    const basket = { postalCode: "K2K 1X1", lines: [{ itemId: item, quantity: 1, modifierIds: ["lunch-jasmine-rice", "lunch-soup-of-day", "lunch-gravy"] }] };
    const quote = await post("/v1/auth/deliveries/quote", basket);
    assert.equal(quote.status, 200);
    assert.equal((await quote.json()).totalCents, 1550);

    assert.equal((await post(path, { expectedVersion: updated.version, patch: { available: false } }, cookie)).status, 200);
    assert.equal((await post("/v1/auth/deliveries/quote", basket)).status, 400);
  } finally {
    if (published) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE shared_preview_menu SET version=version+1 WHERE singleton");
        await client.query("DELETE FROM shared_preview_menu_items WHERE item_id=$1", [item]);
        await client.query("COMMIT");
      } finally { client.release(); }
    }
    await db.query("DELETE FROM customer_accounts WHERE email_normalized=$1", [email]);
    await db.end();
    await app.close();
  }
});
