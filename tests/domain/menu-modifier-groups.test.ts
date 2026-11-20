import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMenuItemPatch,
  availableDishModifierGroups,
  buildCatalog,
  createCustomMenuItem,
  defaultCatalog,
  validateNewMenuItem,
  validatePatch,
} from "../../packages/domain/src/catalog";
import { priceLine } from "../../packages/domain/src/pricing";

const customId = "lunch-custom-00000000-0000-4000-8000-000000000001";
const packaged = defaultCatalog.find(
  (item) => item.id === "lunch-chilli-chicken",
)!;
const originalIds = ["lunch-side", "lunch-soup-or-pop", "lunch-preparation"];

test("omitted dish choices preserve defaults while a saved subset keeps source ordering", () => {
  assert.deepEqual(
    availableDishModifierGroups(packaged).map((group) => group.id),
    originalIds,
  );
  assert.deepEqual(buildCatalog({}), defaultCatalog);
  const item = applyMenuItemPatch(
    packaged,
    validatePatch({
      modifierGroupIds: ["lunch-preparation", "lunch-soup-or-pop"],
    }),
  );
  assert.deepEqual(item.modifierGroupIds, [
    "lunch-soup-or-pop",
    "lunch-preparation",
  ]);
  assert.deepEqual(
    item.modifierGroups?.map((group) => group.id),
    item.modifierGroupIds,
  );
  assert.equal(
    priceLine(
      {
        itemId: item.id,
        quantity: 1,
        modifierIds: ["lunch-pop", "lunch-gravy"],
      },
      [item],
    ).lineTotalCents,
    packaged.priceCents,
  );
  assert.throws(
    () =>
      priceLine(
        {
          itemId: item.id,
          quantity: 1,
          modifierIds: ["lunch-jasmine-rice", "lunch-pop", "lunch-gravy"],
        },
        [item],
      ),
    /does not belong/,
  );
  assert.deepEqual(
    availableDishModifierGroups(item).map((group) => group.id),
    originalIds,
  );
});

test("no choices permits a plain dish and updates only stock inclusion descriptions", () => {
  const plain = applyMenuItemPatch(packaged, { modifierGroupIds: [] });
  assert.deepEqual(plain.modifierGroups, []);
  assert.equal(plain.description, "Includes a vegetable spring roll.");
  assert.equal(
    priceLine({ itemId: plain.id, quantity: 1 }, [plain]).lineTotalCents,
    packaged.priceCents,
  );
  const restored = applyMenuItemPatch(plain, { modifierGroupIds: originalIds });
  assert.equal(restored.description, packaged.description);
  const customCopy = applyMenuItemPatch(packaged, {
    description: "Restaurant-authored description.",
    modifierGroupIds: [],
  });
  assert.equal(customCopy.description, "Restaurant-authored description.");
  assert.throws(
    () => applyMenuItemPatch(packaged, { modifierGroupIds: ["lunch-style"] }),
    /do not apply/,
  );
  assert.throws(
    () => validatePatch({ modifierGroupIds: ["not-a-group"] }),
    /supported/,
  );
  assert.throws(
    () => validatePatch({ modifierGroupIds: ["lunch-side", "lunch-side"] }),
    /at most once/,
  );
  assert.throws(
    () => validatePatch({ modifierGroupIds: "lunch-side" }),
    /supported/,
  );
});

test("custom dish choices survive serialized catalog rebuilding and category eligibility checks", () => {
  const fields = {
    name: "Synthetic custom dish",
    categoryId: "lunch-chicken",
    priceCents: 1250,
  };
  const initial = createCustomMenuItem(customId, validateNewMenuItem(fields));
  assert.deepEqual(
    initial.modifierGroups?.map((group) => group.id),
    originalIds,
  );
  assert.deepEqual(
    availableDishModifierGroups({ categoryId: "lunch-rice-noodles" }).map(
      (group) => group.id,
    ),
    ["lunch-side", "lunch-soup-or-pop"],
  );
  const plain = createCustomMenuItem(
    customId,
    validateNewMenuItem({ ...fields, modifierGroupIds: [] }),
  );
  const decoded = JSON.parse(JSON.stringify(plain));
  const { id, ...editable } = decoded;
  delete editable.modifierGroups;
  delete editable.fixture;
  const rebuilt = createCustomMenuItem(id, validateNewMenuItem(editable));
  assert.deepEqual(rebuilt.modifierGroupIds, []);
  assert.deepEqual(rebuilt.modifierGroups, []);
  assert.equal(
    priceLine({ itemId: customId, quantity: 1 }, [rebuilt]).lineTotalCents,
    1250,
  );
  const selected = applyMenuItemPatch(initial, {
    modifierGroupIds: ["lunch-preparation"],
  });
  assert.throws(
    () => applyMenuItemPatch(selected, { categoryId: "lunch-rice-noodles" }),
    /do not apply/,
  );
  assert.deepEqual(
    applyMenuItemPatch(selected, {
      categoryId: "lunch-rice-noodles",
      modifierGroupIds: [],
    }).modifierGroups,
    [],
  );
  assert.throws(
    () => validateNewMenuItem({ ...fields, modifierGroupIds: ["lunch-style"] }),
    /do not apply/,
  );
});

test("packaged category changes preserve their original source groups", () => {
  const withStyle = defaultCatalog.find(
    (item) => item.id === "lunch-mixed-vegetables",
  )!;
  const changed = applyMenuItemPatch(withStyle, {
    categoryId: "lunch-rice-noodles",
  });
  assert.deepEqual(changed.modifierGroups, withStyle.modifierGroups);
  const starter = defaultCatalog.find(
    (item) => item.id === "crispy-spring-rolls",
  )!;
  assert.deepEqual(availableDishModifierGroups(starter), []);
  assert.throws(
    () => applyMenuItemPatch(starter, { modifierGroupIds: ["spice"] }),
    /do not apply/,
  );
});
