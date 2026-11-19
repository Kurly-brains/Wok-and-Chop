import type { Category, MenuItem, ModifierGroup } from './types';

export interface LunchMenuItem extends MenuItem {
  id: `lunch-${string}`;
  fixture: true;
}

/** Transcribed from the owner's supplied lunch menu; ordering remains disabled. */
export const lunchMenuDetails = Object.freeze({
  sourceLabel: 'Owner-supplied lunch menu',
  currency: 'CAD' as const,
  priceCents: 1399,
  startTime: '12:00',
  endTime: '15:00',
  timeZone: 'America/Toronto',
  holidaysExcluded: true,
  includedItems: Object.freeze(['Jasmine rice', 'Vegetable spring roll', 'Soup of the day or pop']),
  friedRiceUpgradeCents: 250,
  dryPreparationCents: 100,
  fixture: true as const,
});

export const lunchCategories: readonly Category[] = Object.freeze([
  { id: 'lunch-chicken', name: 'Chicken' },
  { id: 'lunch-beef', name: 'Beef' },
  { id: 'lunch-fish', name: 'Fish' },
  { id: 'lunch-vegetarian', name: 'Vegetarian' },
  { id: 'lunch-rice-noodles', name: 'Rice & noodles' },
]);

export const lunchSideGroup: ModifierGroup = {
  id: 'lunch-side', name: 'Rice accompaniment', min: 1, max: 1,
  options: [
    { id: 'lunch-jasmine-rice', name: 'Jasmine rice', priceCents: 0 },
    { id: 'lunch-fried-rice', name: 'Substitute fried rice', priceCents: lunchMenuDetails.friedRiceUpgradeCents },
  ],
};
export const lunchSoupOrPopGroup: ModifierGroup = {
  id: 'lunch-soup-or-pop', name: 'Soup or pop', min: 1, max: 1,
  options: [
    { id: 'lunch-soup-of-day', name: 'Soup of the day', priceCents: 0 },
    { id: 'lunch-pop', name: 'Pop', priceCents: 0 },
  ],
};
export const lunchPreparationGroup: ModifierGroup = {
  id: 'lunch-preparation', name: 'Preparation', min: 1, max: 1,
  options: [
    { id: 'lunch-gravy', name: 'With gravy', priceCents: 0 },
    { id: 'lunch-dry', name: 'Dry', priceCents: lunchMenuDetails.dryPreparationCents },
  ],
};

const vegetableStyle: ModifierGroup = {
  id: 'lunch-style', name: 'Style', min: 1, max: 1,
  options: [
    { id: 'lunch-style-chilli', name: 'Chilli', priceCents: 0 },
    { id: 'lunch-style-hot-garlic', name: 'Hot Garlic', priceCents: 0 },
    { id: 'lunch-style-szechuan', name: 'Szechuan', priceCents: 0 },
  ],
};
const riceAndNoodleStyle: ModifierGroup = {
  id: 'lunch-style', name: 'Style', min: 1, max: 1,
  options: [
    { id: 'lunch-style-hakka', name: 'Hakka', priceCents: 0 },
    { id: 'lunch-style-manchurian', name: 'Manchurian', priceCents: 0 },
    { id: 'lunch-style-szechuan', name: 'Szechuan', priceCents: 0 },
  ],
};

const featuredIds = new Set(['lunch-chilli-chicken', 'lunch-chicken-chow-mein', 'lunch-kung-pao-beef', 'lunch-veg-manchurian']);
function item(
  slug: string,
  name: string,
  categoryId: string,
  options: { heatLevel?: 0 | 1 | 2; containsPeanuts?: boolean; style?: ModifierGroup } = {},
): LunchMenuItem {
  const id = `lunch-${slug}` as const;
  const modifierGroups: ModifierGroup[] = [lunchSideGroup, lunchSoupOrPopGroup];
  if (categoryId !== 'lunch-rice-noodles') modifierGroups.push(lunchPreparationGroup);
  if (options.style) modifierGroups.push(options.style);
  return {
    id, name, categoryId, priceCents: lunchMenuDetails.priceCents,
    description: 'Includes jasmine rice, a vegetable spring roll, and soup of the day or pop.',
    fixture: true, featured: featuredIds.has(id),
    ...(categoryId === 'lunch-vegetarian' ? { vegetarian: true } : {}),
    ...(options.heatLevel === undefined ? {} : { heatLevel: options.heatLevel, spicy: options.heatLevel > 0 }),
    ...(options.containsPeanuts === true ? { containsPeanuts: true } : {}),
    modifierGroups,
  };
}

export const lunchMenuItems: readonly LunchMenuItem[] = [
  item('chilli-chicken', 'Chilli Chicken', 'lunch-chicken', { heatLevel: 1 }),
  item('manchurian-chicken', 'Manchurian Chicken', 'lunch-chicken', { heatLevel: 2 }),
  item('hot-garlic-chicken', 'Hot Garlic Chicken', 'lunch-chicken', { heatLevel: 1 }),
  item('szechuan-chicken', 'Szechuan Chicken', 'lunch-chicken', { heatLevel: 2 }),
  item('sweet-sour-chicken-pineapple', 'Sweet & Sour Chicken with Pineapple', 'lunch-chicken', { heatLevel: 0 }),
  item('sweet-sour-manchurian-chicken', 'Sweet & Sour Manchurian Chicken', 'lunch-chicken', { heatLevel: 0 }),
  item('general-tao-chicken', 'General Tao Chicken', 'lunch-chicken', { heatLevel: 0 }),
  item('kung-pao-chicken', 'Kung Pao Chicken', 'lunch-chicken', { heatLevel: 1, containsPeanuts: true }),
  item('karachi-chicken', 'Karachi Chicken', 'lunch-chicken', { heatLevel: 2 }),
  item('orange-chicken', 'Orange Chicken', 'lunch-chicken', { heatLevel: 0 }),
  item('lemon-chicken', 'Lemon Chicken', 'lunch-chicken', { heatLevel: 0 }),
  item('honey-garlic-chicken', 'Honey Garlic Chicken', 'lunch-chicken', { heatLevel: 0 }),
  item('chicken-broccoli', 'Chicken with Broccoli', 'lunch-chicken', { heatLevel: 0 }),
  item('chicken-mixed-vegetables', 'Chicken with Mixed Vegetables', 'lunch-chicken', { heatLevel: 0 }),
  item('butter-chicken', 'Butter Chicken', 'lunch-chicken', { heatLevel: 0 }),

  item('chilli-beef', 'Chilli Beef', 'lunch-beef', { heatLevel: 1 }),
  item('manchurian-beef', 'Manchurian Beef', 'lunch-beef', { heatLevel: 2 }),
  item('hot-garlic-beef', 'Hot Garlic Beef', 'lunch-beef', { heatLevel: 1 }),
  item('szechuan-beef', 'Szechuan Beef', 'lunch-beef', { heatLevel: 2 }),
  item('sweet-sour-beef-pineapple', 'Sweet & Sour Beef with Pineapple', 'lunch-beef', { heatLevel: 0 }),
  item('sweet-sour-manchurian-beef', 'Sweet & Sour Manchurian Beef', 'lunch-beef', { heatLevel: 2 }),
  item('mongolian-beef', 'Mongolian Beef', 'lunch-beef', { heatLevel: 1 }),
  item('kung-pao-beef', 'Kung Pao Beef', 'lunch-beef', { heatLevel: 1, containsPeanuts: true }),
  item('black-bean-beef', 'Black Bean Beef', 'lunch-beef', { heatLevel: 0 }),
  item('beef-broccoli', 'Beef with Broccoli', 'lunch-beef', { heatLevel: 0 }),

  item('chilli-fish', 'Chilli Fish', 'lunch-fish', { heatLevel: 1 }),
  item('manchurian-fish', 'Manchurian Fish', 'lunch-fish', { heatLevel: 2 }),
  item('hot-garlic-fish', 'Hot Garlic Fish', 'lunch-fish', { heatLevel: 1 }),
  item('szechuan-fish', 'Szechuan Fish', 'lunch-fish', { heatLevel: 2 }),
  item('sweet-sour-fish-pineapple', 'Sweet & Sour Fish with Pineapple', 'lunch-fish', { heatLevel: 0 }),
  item('sweet-sour-manchurian-fish', 'Sweet & Sour Manchurian Fish', 'lunch-fish', { heatLevel: 0 }),

  item('veg-manchurian', 'Veg Manchurian', 'lunch-vegetarian'),
  item('mixed-vegetables', 'Mixed Vegetables', 'lunch-vegetarian', { style: vegetableStyle }),
  item('veg-fried-rice', 'Veg Fried Rice', 'lunch-vegetarian', { style: riceAndNoodleStyle }),
  item('veg-chow-mein', 'Veg Chow Mein', 'lunch-vegetarian', { style: riceAndNoodleStyle }),

  item('chicken-egg-fried-rice', 'Chicken & Egg Fried Rice', 'lunch-rice-noodles', { style: riceAndNoodleStyle }),
  item('chicken-chow-mein', 'Chicken Chow Mein', 'lunch-rice-noodles'),
];

const lunchIds = new Set(lunchMenuItems.map((entry) => entry.id));
export function isLunchMenuItem(value: MenuItem): value is LunchMenuItem {
  return lunchIds.has(value.id as LunchMenuItem['id']);
}
