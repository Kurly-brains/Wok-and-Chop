import type { Category, MenuItem, ModifierGroup } from './types';

export const MENU_CONTENT_STATUS = 'DESIGN_PREVIEW_ONLY' as const;
export const MENU_NOTICE = 'Sample dishes and prices for design preview. The restaurant menu is awaiting approval.';

export const categories: readonly Category[] = [
  { id: 'all', name: 'All dishes' },
  { id: 'starters', name: 'Small plates' },
  { id: 'noodles', name: 'Noodles' },
  { id: 'rice', name: 'Rice' },
  { id: 'wok', name: 'From the wok' },
  { id: 'vegetarian', name: 'Vegetarian' },
];

export const spiceGroup: ModifierGroup = {
  id: 'spice', name: 'Spice level', min: 1, max: 1,
  options: [
    { id: 'spice-mild', name: 'Mild', priceCents: 0 },
    { id: 'spice-medium', name: 'Medium', priceCents: 0 },
    { id: 'spice-hot', name: 'Hot', priceCents: 0 },
  ],
};

export const menuItems: readonly MenuItem[] = [
  { id: 'chilli-chicken', name: 'Chilli chicken', description: 'Crisp chicken, green chillies, peppers and a dark garlic sauce.', categoryId: 'wok', priceCents: 1695, spicy: true, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'hakka-noodles', name: 'Hakka noodles', description: 'Wok-tossed noodles with crunchy vegetables, scallions and soy.', categoryId: 'noodles', priceCents: 1495, vegetarian: true, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'schezwan-fried-rice', name: 'Schezwan fried rice', description: 'Long-grain rice, vegetables and a lively chilli-garlic sauce.', categoryId: 'rice', priceCents: 1495, vegetarian: true, spicy: true, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'crispy-spring-rolls', name: 'Crispy spring rolls', description: 'Golden vegetable rolls with a sweet chilli dipping sauce.', categoryId: 'starters', priceCents: 695, vegetarian: true, fixture: true },
  { id: 'manchurian-cauliflower', name: 'Gobi Manchurian', description: 'Crisp cauliflower tossed with ginger, garlic and scallions.', categoryId: 'vegetarian', priceCents: 1495, vegetarian: true, spicy: true, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'chicken-fried-rice', name: 'Chicken fried rice', description: 'Wok-fried rice with chicken, egg, garden vegetables and scallions.', categoryId: 'rice', priceCents: 1595, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'chilli-paneer', name: 'Chilli paneer', description: 'Paneer, bell peppers and onions in a punchy chilli-garlic glaze.', categoryId: 'vegetarian', priceCents: 1595, vegetarian: true, spicy: true, fixture: true, modifierGroups: [spiceGroup] },
  { id: 'chicken-lollipops', name: 'Chicken lollipops', description: 'Crisp chicken drumettes with a warming chilli dipping sauce.', categoryId: 'starters', priceCents: 1295, spicy: true, fixture: true },
  { id: 'chicken-hakka-noodles', name: 'Chicken Hakka noodles', description: 'Noodles tossed over high heat with chicken, cabbage and scallions.', categoryId: 'noodles', priceCents: 1695, fixture: true, modifierGroups: [spiceGroup] },
];

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Money must be an integer number of CAD cents.');
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}
