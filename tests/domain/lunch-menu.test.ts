import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLunchMenuItem, lunchCategories, lunchMenuDetails, lunchMenuItems, menuItems, previewTaxProfile, priceCart, priceLine, type LunchMenuItem } from '../../packages/domain/src/index';

function dish(id: string): LunchMenuItem {
  const found = lunchMenuItems.find((item) => item.id === id);
  assert.ok(found, `Missing source lunch dish: ${id}`);
  return found;
}
function includedOptions(item: LunchMenuItem): string[] {
  return (item.modifierGroups ?? []).map((group) => group.options[0].id);
}

test('Owner lunch source contains exactly 37 unique dishes in the supplied category counts', () => {
  assert.equal(lunchMenuItems.length, 37);
  assert.equal(new Set(lunchMenuItems.map((item) => item.id)).size, 37);
  assert.deepEqual(lunchCategories.map((category) => [category.id, lunchMenuItems.filter((item) => item.categoryId === category.id).length]), [
    ['lunch-chicken', 15], ['lunch-beef', 10], ['lunch-fish', 6], ['lunch-vegetarian', 4], ['lunch-rice-noodles', 2],
  ]);
  assert.ok(lunchMenuItems.every((item) => item.priceCents === 1399 && item.fixture && isLunchMenuItem(item)));
  assert.ok(menuItems.every((item) => !isLunchMenuItem(item)));
  assert.equal(menuItems.length, 9);
  assert.equal(dish('lunch-sweet-sour-chicken-pineapple').name, 'Sweet & Sour Chicken with Pineapple');
  assert.equal(dish('lunch-sweet-sour-manchurian-beef').name, 'Sweet & Sour Manchurian Beef');
  assert.equal(dish('lunch-chicken-egg-fried-rice').name, 'Chicken & Egg Fried Rice');
  assert.equal(dish('lunch-butter-chicken').name, 'Butter Chicken');
});

test('Lunch source details retain noon–3 p.m., holiday exclusion, inclusions and exact upgrade cents', () => {
  assert.equal(lunchMenuDetails.sourceLabel, 'Owner-supplied lunch menu');
  assert.equal(lunchMenuDetails.startTime, '12:00');
  assert.equal(lunchMenuDetails.endTime, '15:00');
  assert.equal(lunchMenuDetails.timeZone, 'America/Toronto');
  assert.equal(lunchMenuDetails.holidaysExcluded, true);
  assert.equal(lunchMenuDetails.currency, 'CAD');
  assert.deepEqual(lunchMenuDetails.includedItems, ['Jasmine rice', 'Vegetable spring roll', 'Soup of the day or pop']);
  assert.equal(lunchMenuDetails.friedRiceUpgradeCents, 250);
  assert.equal(lunchMenuDetails.dryPreparationCents, 100);
});

test('All lunch included choices price at $13.99; fried rice and dry choices add exact cents per meal', () => {
  for (const item of lunchMenuItems) {
    const line = priceLine({ itemId: item.id, quantity: 1, modifierIds: includedOptions(item) }, lunchMenuItems);
    assert.equal(line.lineTotalCents, 1399, item.name);
  }
  const upgraded = priceLine({ itemId: 'lunch-chilli-chicken', quantity: 2, modifierIds: ['lunch-fried-rice', 'lunch-pop', 'lunch-dry'] }, lunchMenuItems);
  assert.equal(upgraded.unitPriceCents, 1749);
  assert.equal(upgraded.lineTotalCents, 3498);
  assert.deepEqual(upgraded.modifiers.map((option) => option.priceCents), [250, 0, 100]);
});

test('Lunch side, soup/pop, preparation and listed style choices are required and mutually exclusive', () => {
  assert.throws(() => priceLine({ itemId: 'lunch-chilli-chicken', quantity: 1, modifierIds: [] }, lunchMenuItems), /Rice accompaniment/);
  assert.throws(() => priceLine({ itemId: 'lunch-chilli-chicken', quantity: 1, modifierIds: ['lunch-jasmine-rice', 'lunch-soup-of-day', 'lunch-pop', 'lunch-gravy'] }, lunchMenuItems), /Soup or pop/);
  assert.throws(() => priceLine({ itemId: 'lunch-mixed-vegetables', quantity: 1, modifierIds: ['lunch-jasmine-rice', 'lunch-pop', 'lunch-gravy'] }, lunchMenuItems), /Style/);
  assert.equal(priceLine({ itemId: 'lunch-mixed-vegetables', quantity: 1, modifierIds: ['lunch-jasmine-rice', 'lunch-pop', 'lunch-gravy', 'lunch-style-hot-garlic'] }, lunchMenuItems).lineTotalCents, 1399);
  assert.throws(() => priceLine({ itemId: 'lunch-chicken-chow-mein', quantity: 1, modifierIds: ['lunch-jasmine-rice', 'lunch-pop', 'lunch-dry'] }, lunchMenuItems), /does not belong/);
  assert.throws(() => priceLine({ itemId: 'lunch-veg-fried-rice', quantity: 1, modifierIds: ['lunch-jasmine-rice', 'lunch-pop', 'lunch-gravy', 'lunch-style-chilli'] }, lunchMenuItems), /does not belong/);
});

test('Lunch heat and peanut markers preserve supplied distinctions without inferring allergen-free dishes', () => {
  assert.equal(dish('lunch-chilli-chicken').heatLevel, 1);
  assert.equal(dish('lunch-manchurian-chicken').heatLevel, 2);
  assert.equal(dish('lunch-sweet-sour-manchurian-chicken').heatLevel, 0);
  assert.equal(dish('lunch-sweet-sour-manchurian-beef').heatLevel, 2);
  assert.equal(dish('lunch-sweet-sour-manchurian-fish').heatLevel, 0);
  assert.deepEqual(lunchMenuItems.filter((item) => item.containsPeanuts).map((item) => item.id), ['lunch-kung-pao-chicken', 'lunch-kung-pao-beef']);
  assert.equal(dish('lunch-butter-chicken').containsPeanuts, undefined);
  assert.equal(dish('lunch-veg-manchurian').heatLevel, undefined);
  assert.deepEqual(lunchMenuItems.filter((item) => item.featured).map((item) => item.id), ['lunch-chilli-chicken', 'lunch-kung-pao-beef', 'lunch-veg-manchurian', 'lunch-chicken-chow-mein']);
});

test('Owner-supplied lunch content stays fail-closed for live pricing despite imported real menu values', () => {
  const item = dish('lunch-chilli-chicken');
  const lines = [{ itemId: item.id, quantity: 1, modifierIds: includedOptions(item) }];
  const options = { taxProfile: { ...previewTaxProfile, approved: true }, now: new Date('2026-11-18T17:00:00Z') };
  assert.throws(() => priceCart(lines, lunchMenuItems, options), /Approved restaurant menu and tax rules/);
  assert.equal(priceCart(lines, lunchMenuItems, { ...options, preview: true }).subtotalCents, 1399);
});
