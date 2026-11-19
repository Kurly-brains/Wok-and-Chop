import assert from "node:assert/strict";
import { test } from "node:test";
import { lunchMenuItems } from "../../packages/domain/src/lunch-menu";
import { searchLunchMenu } from "../../apps/web/lib/menu-search";

test("lunch search uses published heat and allergen markers and respects categories", () => {
  const names = (query: string, category = "all") =>
    searchLunchMenu(lunchMenuItems, category, query).map((dish) => dish.name);
  assert.deepEqual(names("extra spicy", "lunch-fish"), ["Manchurian Fish", "Szechuan Fish"]);
  assert.deepEqual(names("peanut"), ["Kung Pao Chicken", "Kung Pao Beef"]);
  assert.deepEqual(names("peanut free"), []);
  assert.deepEqual(names("vegan"), []);
});

test("fried rice entrées take precedence over sides, and options and common names are searchable", () => {
  const names = (query: string) => searchLunchMenu(lunchMenuItems, "all", query).map((dish) => dish.name);
  assert.deepEqual(names("fried rice"), ["Veg Fried Rice", "Chicken & Egg Fried Rice"]);
  assert.deepEqual(names("noodles chicken"), ["Chicken Chow Mein"]);
  assert.ok(names("sichuan").includes("Mixed Vegetables"));
  assert.ok(names("jasmine rice").includes("Orange Chicken"));
});

test("browse and search respond to edited availability and descriptions", () => {
  const changed = lunchMenuItems.map((dish) => ({ ...dish, available: false }));
  changed[0] = { ...changed[0], available: true, description: "With roasted red peppers." };
  assert.deepEqual(searchLunchMenu(changed, "all", ""), [changed[0]]);
  assert.deepEqual(searchLunchMenu(changed, "all", "roasted peppers"), [changed[0]]);
  assert.deepEqual(searchLunchMenu(changed, "all", "Manchurian"), []);
});
