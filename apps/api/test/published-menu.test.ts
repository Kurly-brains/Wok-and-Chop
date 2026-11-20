import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { buildCatalog } from "../../../packages/domain/src/catalog";
import { hash } from "../src/order-input";

const dbUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://127.0.0.1:3000";

test(
  "manager publishing shares a valid photo and price with the public menu and server quote",
  { skip: !dbUrl },
  async () => {
    if (new URL(dbUrl!).pathname !== "/wok_chop_auth_test")
      throw new Error("Dedicated test database required");
    const app = await createApplication({
      authDatabaseUrl: dbUrl,
      webOrigin: origin,
      trainingDatabasePath: ":memory:",
    });
    const db = new Pool({ connectionString: dbUrl });
    const item = "lunch-mongolian-beef";
    const email = `menu-${randomUUID()}@example.invalid`;
    let published = false;
    let managerId: string | null = null;
    let didReset = false;
    const pickupRequestIds: string[] = [];
    const pickupSubjects: string[] = [];
    const baseline = await db.query<{
      item_id: string;
      patch: unknown;
      updated_by: string | null;
      updated_at: Date;
    }>("SELECT * FROM shared_preview_menu_items");

    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const post = (path: string, body: unknown, cookie?: string) =>
        fetch(base + path, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        });
      const current = await (await fetch(base + "/v1/menu")).json();
      assert.equal(current.overrides[item], undefined);
      const catalog = buildCatalog(current.overrides, current.customItems);
      let optionChecks = 0;
      for (const dish of catalog) {
        const groups = dish.modifierGroups ?? [];
        const defaults = groups.flatMap((group) =>
          group.options
            .filter((option) => option.available !== false)
            .slice(0, group.min)
            .map((option) => option.id),
        );
        const variants = [
          defaults,
          ...groups.flatMap((group) =>
            group.options
              .filter((option) => option.available !== false)
              .map((option) => [
                ...defaults.filter(
                  (id) =>
                    !group.options.some((candidate) => candidate.id === id),
                ),
                option.id,
                ...group.options
                  .filter(
                    (candidate) =>
                      candidate.available !== false &&
                      candidate.id !== option.id,
                  )
                  .slice(0, Math.max(0, group.min - 1))
                  .map((candidate) => candidate.id),
              ]),
          ),
        ];
        const uniqueVariants = [
          ...new Map(
            variants.map((ids) => [ids.slice().sort().join(","), ids]),
          ).values(),
        ];
        for (const modifierIds of uniqueVariants) {
          const response = await post("/v1/auth/pickups/quote", {
            lines: [{ itemId: dish.id, quantity: 1, modifierIds }],
          });
          assert.equal(
            response.status,
            dish.available === false ? 400 : 200,
            dish.id,
          );
          if (dish.available !== false) {
            const extraCents = groups
              .flatMap((group) => group.options)
              .filter((option) => modifierIds.includes(option.id))
              .reduce((total, option) => total + option.priceCents, 0);
            assert.equal(
              (await response.json()).totalCents,
              dish.priceCents + extraCents,
              dish.id,
            );
          }
          optionChecks++;
        }
      }
      assert.ok(catalog.length >= 46);
      assert.ok(optionChecks > catalog.length);
      const registered = await post("/v1/auth/register", {
        name: "Menu test manager",
        email,
        password: "Synthetic menu test password!",
      });
      assert.equal(registered.status, 201);
      const { user } = await registered.json();
      managerId = user.id;
      const cookie = registered.headers.get("set-cookie")!.split(";")[0];
      const path = "/v1/auth/admin/menu/items/" + item;
      const patch = {
        expectedVersion: current.version,
        patch: { priceCents: 1550 },
      };
      assert.equal((await post(path, patch)).status, 401);
      assert.equal((await post(path, patch, cookie)).status, 403);
      const newDishPath = "/v1/auth/admin/menu/items";
      const newDish = {
        name: "Synthetic added lunch",
        description: "Synthetic menu integration test dish.",
        categoryId: "lunch-chicken",
        priceCents: 1250,
        available: true,
        heatLevel: 1,
        imagePresentation: "photo",
      };
      const unprivilegedCreate = {
        expectedVersion: current.version,
        requestId: randomUUID(),
        item: newDish,
      };
      assert.equal((await post(newDishPath, unprivilegedCreate)).status, 401);
      assert.equal(
        (await post(newDishPath, unprivilegedCreate, cookie)).status,
        403,
      );
      await db.query(
        "INSERT INTO restaurant_managers(account_id) VALUES ($1)",
        [user.id],
      );

      const base64 = readFileSync(
        join(
          __dirname,
          "../../web/public/images/art/round-rosewood-table.webp",
        ),
      ).toString("base64");
      const image = "data:image/webp;base64," + base64;
      assert.equal((await post("/v1/quotes", { image })).status, 413);
      const saved = await post(
        path,
        { ...patch, patch: { ...patch.patch, image } },
        cookie,
      );
      assert.equal(saved.status, 200);
      published = true;
      assert.equal((await post(path, patch, cookie)).status, 409);

      const updated = await (await fetch(base + "/v1/menu")).json();
      assert.equal(updated.overrides[item].priceCents, 1550);
      assert.equal(updated.overrides[item].image, image);
      const unchanged = await (
        await fetch(base + "/v1/menu?after=" + updated.version)
      ).json();
      assert.equal(unchanged.overrides, null);

      const basket = {
        lines: [
          {
            itemId: item,
            quantity: 1,
            modifierIds: [
              "lunch-jasmine-rice",
              "lunch-soup-of-day",
              "lunch-gravy",
            ],
          },
        ],
      };
      const quote = await post("/v1/auth/pickups/quote", basket);
      assert.equal(quote.status, 200);
      assert.equal((await quote.json()).totalCents, 1550);

      assert.equal(
        (
          await post(
            path,
            { expectedVersion: updated.version, patch: { available: false } },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal((await post("/v1/auth/pickups/quote", basket)).status, 400);

      const beforeCreate = await (await fetch(base + "/v1/menu")).json();
      const creation = {
        expectedVersion: beforeCreate.version,
        requestId: randomUUID(),
        item: { ...newDish, image },
      };
      assert.equal(
        (
          await post(
            newDishPath,
            { ...creation, item: { ...creation.item, priceCents: 0 } },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await post(
            newDishPath,
            { ...creation, item: { ...creation.item, modifierGroups: [] } },
            cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await post(
            newDishPath,
            {
              ...creation,
              item: {
                ...creation.item,
                image: "data:image/png;base64,aGVsbG8=",
              },
            },
            cookie,
          )
        ).status,
        400,
      );
      const creates = await Promise.all([
        post(newDishPath, creation, cookie),
        post(newDishPath, creation, cookie),
      ]);
      assert.deepEqual(
        creates.map((result) => result.status),
        [201, 201],
      );
      const created = await Promise.all(creates.map((result) => result.json()));
      assert.equal(created[0].item.id, created[1].item.id);
      assert.equal(created[0].version, beforeCreate.version + 1);
      const customId = created[0].item.id;
      assert.match(customId, /^lunch-custom-[a-f0-9-]{36}$/);
      assert.equal(created[0].item.fixture, true);
      const reorderedRetry = await post(
        newDishPath,
        {
          ...creation,
          item: Object.fromEntries(Object.entries(creation.item).reverse()),
        },
        cookie,
      );
      assert.equal(reorderedRetry.status, 201);
      assert.equal((await reorderedRetry.json()).item.id, customId);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM shared_preview_custom_menu_items WHERE created_by=$1",
            [managerId],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await post(
            newDishPath,
            {
              ...creation,
              item: { ...creation.item, name: "Changed request" },
            },
            cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await post(
            newDishPath,
            { ...creation, requestId: randomUUID() },
            cookie,
          )
        ).status,
        409,
      );
      const publicCreated = await (await fetch(base + "/v1/menu")).json();
      assert.equal(
        publicCreated.customItems.find(
          (entry: { id: string }) => entry.id === customId,
        ).image,
        image,
      );
      assert.equal(publicCreated.overrides[item].available, false);
      const same = await (
        await fetch(base + "/v1/menu?after=" + publicCreated.version)
      ).json();
      assert.equal(same.customItems, null);
      assert.equal(same.overrides, null);
      const customBasket = {
        lines: [
          {
            itemId: customId,
            quantity: 1,
            modifierIds: [
              "lunch-jasmine-rice",
              "lunch-soup-of-day",
              "lunch-gravy",
            ],
          },
        ],
      };
      const firstQuote = await post("/v1/auth/pickups/quote", customBasket);
      assert.equal(firstQuote.status, 200);
      const initialQuote = await firstQuote.json();
      assert.equal(initialQuote.totalCents, 1250);
      assert.equal(
        (
          await post("/v1/auth/pickups/quote", {
            lines: [{ itemId: customId, quantity: 1, priceCents: 1 }],
          })
        ).status,
        400,
      );

      const repricedBeforeSubmit = await post(
        newDishPath + "/" + customId,
        {
          expectedVersion: publicCreated.version,
          patch: { priceCents: 1650 },
        },
        cookie,
      );
      assert.equal(repricedBeforeSubmit.status, 200);
      const currentPriceVersion = (await repricedBeforeSubmit.json()).version;
      const pickupRequestId = randomUUID();
      pickupRequestIds.push(pickupRequestId);
      const pickupBody = {
        ...customBasket,
        requestId: pickupRequestId,
        name: "Synthetic custom dish customer",
        phone: "613-555-0108",
        email,
        quoteFingerprint: initialQuote.quoteFingerprint,
        expectedTotalCents: initialQuote.totalCents,
      };
      assert.equal(
        (await post("/v1/auth/pickups", pickupBody, cookie)).status,
        409,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM delivery_orders WHERE request_hash=$1",
            [hash("pickup-request-v1:" + pickupRequestId)],
          )
        ).rows[0].count,
        0,
      );
      const reviewed = await (
        await post("/v1/auth/pickups/quote", customBasket)
      ).json();
      assert.equal(reviewed.totalCents, 1650);
      const acceptedBody = {
        ...pickupBody,
        quoteFingerprint: reviewed.quoteFingerprint,
        expectedTotalCents: reviewed.totalCents,
      };
      const accepted = await post("/v1/auth/pickups", acceptedBody, cookie);
      assert.equal(accepted.status, 201);
      const receipt = await accepted.json();
      pickupSubjects.push(`New Wok & Chop pickup ${receipt.pickup.number}`);
      assert.equal(receipt.pickup.totalCents, 1650);
      const savedPickup = (
        await db.query("SELECT snapshot FROM delivery_orders WHERE id=$1", [
          receipt.pickup.id,
        ])
      ).rows[0].snapshot;
      assert.equal(savedPickup.lines[0].itemId, customId);
      assert.equal(savedPickup.lines[0].basePriceCents, 1650);

      const edited = await post(
        newDishPath + "/" + customId,
        {
          expectedVersion: currentPriceVersion,
          patch: { priceCents: 1700, categoryId: "lunch-rice-noodles" },
        },
        cookie,
      );
      assert.equal(edited.status, 200);
      const editedVersion = (await edited.json()).version;
      const riceBasket = {
        lines: [
          {
            itemId: customId,
            quantity: 1,
            modifierIds: ["lunch-jasmine-rice", "lunch-soup-of-day"],
          },
        ],
      };
      const repriced = await post("/v1/auth/pickups/quote", riceBasket);
      assert.equal(repriced.status, 200);
      assert.equal((await repriced.json()).totalCents, 1700);
      assert.equal(
        (await post("/v1/auth/pickups/quote", customBasket)).status,
        400,
      );
      const unavailable = await post(
        newDishPath + "/" + customId,
        { expectedVersion: editedVersion, patch: { available: false } },
        cookie,
      );
      assert.equal(unavailable.status, 200);
      assert.equal(
        (await post("/v1/auth/pickups/quote", riceBasket)).status,
        400,
      );
      const reset = await post(
        "/v1/auth/admin/menu/reset",
        { expectedVersion: (await unavailable.json()).version },
        cookie,
      );
      assert.equal(reset.status, 200);
      didReset = true;
      const resetPublic = await (await fetch(base + "/v1/menu")).json();
      assert.deepEqual(resetPublic.overrides, {});
      assert.ok(
        resetPublic.customItems.some(
          (entry: { id: string }) => entry.id === customId,
        ),
      );
      const restored = await post("/v1/auth/pickups/quote", customBasket);
      assert.equal(restored.status, 200);
      assert.equal((await restored.json()).totalCents, 1250);
      const replay = await post("/v1/auth/pickups", acceptedBody, cookie);
      assert.equal(replay.status, 201);
      assert.deepEqual(await replay.json(), receipt);
      const tracked = await post("/v1/auth/pickups/track", {
        trackingToken: receipt.trackingToken,
        number: receipt.pickup.number,
      });
      assert.equal(tracked.status, 200);
      assert.equal((await tracked.json()).pickup.totalCents, 1650);
      const packaged = await post("/v1/auth/pickups/quote", basket);
      assert.equal(packaged.status, 200);
      assert.equal((await packaged.json()).totalCents, 1399);
      for (const modifierGroupIds of [
        ["unknown-group"],
        ["lunch-side", "lunch-side"],
        ["lunch-style"],
      ]) {
        assert.equal(
          (
            await post(
              newDishPath + "/" + item,
              {
                expectedVersion: resetPublic.version,
                patch: { modifierGroupIds },
              },
              cookie,
            )
          ).status,
          400,
        );
      }
      assert.equal(
        (await (await fetch(base + "/v1/menu")).json()).version,
        resetPublic.version,
      );
      const disabledChoices = await post(
        newDishPath + "/" + item,
        {
          expectedVersion: resetPublic.version,
          patch: { modifierGroupIds: [] },
        },
        cookie,
      );
      assert.equal(disabledChoices.status, 200);
      const noChoices = await post("/v1/auth/pickups/quote", {
        lines: [{ itemId: item, quantity: 1 }],
      });
      assert.equal(noChoices.status, 200);
      assert.equal((await noChoices.json()).totalCents, 1399);
      assert.equal((await post("/v1/auth/pickups/quote", basket)).status, 400);
      const currentPublished = await (await fetch(base + "/v1/menu")).json();
      const publicDish = buildCatalog(
        currentPublished.overrides,
        currentPublished.customItems,
      ).find((dish) => dish.id === item)!;
      assert.deepEqual(publicDish.modifierGroups, []);
      assert.equal(publicDish.description, "Includes a vegetable spring roll.");
      const choosePreparation = await post(
        newDishPath + "/" + customId,
        {
          expectedVersion: currentPublished.version,
          patch: { modifierGroupIds: ["lunch-preparation"] },
        },
        cookie,
      );
      assert.equal(choosePreparation.status, 200);
      const selectionVersion = (await choosePreparation.json()).version;
      assert.equal(
        (
          await post(
            newDishPath + "/" + customId,
            {
              expectedVersion: selectionVersion,
              patch: { categoryId: "lunch-rice-noodles" },
            },
            cookie,
          )
        ).status,
        400,
      );
      const changeCategory = await post(
        newDishPath + "/" + customId,
        {
          expectedVersion: selectionVersion,
          patch: { categoryId: "lunch-rice-noodles", modifierGroupIds: [] },
        },
        cookie,
      );
      assert.equal(changeCategory.status, 200);
      const plainCustom = await post("/v1/auth/pickups/quote", {
        lines: [{ itemId: customId, quantity: 1 }],
      });
      assert.equal(plainCustom.status, 200);
      assert.equal((await plainCustom.json()).totalCents, 1250);
      const plainCreation = await post(
        newDishPath,
        {
          expectedVersion: (await changeCategory.json()).version,
          requestId: randomUUID(),
          item: {
            ...newDish,
            name: "Synthetic no-choice dish",
            modifierGroupIds: [],
          },
        },
        cookie,
      );
      assert.equal(plainCreation.status, 201);
      const plainCreated = (await plainCreation.json()).item;
      assert.deepEqual(plainCreated.modifierGroupIds, []);
      assert.deepEqual(plainCreated.modifierGroups, []);
      const createdCatalog = await (await fetch(base + "/v1/menu")).json();
      assert.deepEqual(
        createdCatalog.customItems.find(
          (dish: { id: string }) => dish.id === plainCreated.id,
        ).modifierGroupIds,
        [],
      );
      assert.equal(
        (
          await post("/v1/auth/pickups/quote", {
            lines: [{ itemId: plainCreated.id, quantity: 1 }],
          })
        ).status,
        200,
      );
      const archive = await post(
        newDishPath + "/" + item,
        { expectedVersion: createdCatalog.version, patch: { archived: true } },
        cookie,
      );
      assert.equal(archive.status, 200);
      const plainBasket = { lines: [{ itemId: item, quantity: 1 }] };
      assert.equal(
        (await post("/v1/auth/pickups/quote", plainBasket)).status,
        400,
      );
      const resetWithArchive = await post(
        "/v1/auth/admin/menu/reset",
        { expectedVersion: (await archive.json()).version },
        cookie,
      );
      assert.equal(resetWithArchive.status, 200);
      const archivedMenu = await (await fetch(base + "/v1/menu")).json();
      assert.deepEqual(archivedMenu.overrides[item], {
        archived: true,
        modifierGroupIds: [],
      });
      const restoreDish = await post(
        newDishPath + "/" + item,
        { expectedVersion: archivedMenu.version, patch: { archived: false } },
        cookie,
      );
      assert.equal(restoreDish.status, 200);
      assert.equal(
        (await post("/v1/auth/pickups/quote", plainBasket)).status,
        200,
      );
    } finally {
      await db.query(
        "DELETE FROM notification_emails WHERE recipient=$1 OR subject=ANY($2::text[])",
        [email, pickupSubjects],
      );
      await db.query(
        "DELETE FROM delivery_orders WHERE request_hash=ANY($1::text[])",
        [pickupRequestIds.map((id) => hash("pickup-request-v1:" + id))],
      );
      if (published || managerId) {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE shared_preview_menu SET version=version+1 WHERE singleton",
          );
          await client.query(
            "DELETE FROM shared_preview_menu_items WHERE item_id=$1 OR item_id IN (SELECT item_id FROM shared_preview_custom_menu_items WHERE created_by=$2)",
            [item, managerId],
          );
          await client.query(
            "DELETE FROM shared_preview_custom_menu_items WHERE created_by=$1",
            [managerId],
          );
          if (didReset)
            for (const row of baseline.rows)
              await client.query(
                "INSERT INTO shared_preview_menu_items(item_id,patch,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(item_id) DO UPDATE SET patch=EXCLUDED.patch,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at",
                [row.item_id, row.patch, row.updated_by, row.updated_at],
              );
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      }
      await db.query(
        "DELETE FROM customer_accounts WHERE email_normalized=$1",
        [email],
      );
      await db.end();
      await app.close();
    }
  },
);
