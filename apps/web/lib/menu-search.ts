import { isLunchMenuItem, lunchCategories, lunchMenuItems, type MenuItem } from "@wok/domain";

const commonLunchDescription = lunchMenuItems[0].description;
const aliases = new Map(Object.entries({
  chili: "chilli", chilies: "chilli", chillies: "chilli",
  sichuan: "szechuan", schezwan: "szechuan", szechwan: "szechuan",
  peanut: "peanuts", noodles: "noodle", veggie: "vegetarian", veg: "vegetarian",
  heat: "spicy", spice: "spicy", seafood: "fish",
}));

function words(text: string) {
  return (text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => !["and", "with", "the", "of"].includes(word))
    .map((word) => aliases.get(word) ?? word);
}

function relevance(item: MenuItem, query: string[]): number {
  if (!query.length) return 1;
  const name = words(item.name);
  const matches = (fields: string[]) => query.every((term) => fields.some((word) => word.startsWith(term)));
  if (matches(name)) return 4;

  const category = lunchCategories.find((entry) => entry.id === item.categoryId);
  const options = item.modifierGroups?.flatMap((group) =>
    group.options.filter((option) => option.available !== false).map((option) => ({
      name: option.name,
      isSide: group.id === "lunch-side" || group.id === "lunch-soup-or-pop",
    })),
  ) ?? [];
  const details = [
    // The combined category includes rice entrées and noodle entrées.
    category?.id === "lunch-rice-noodles" ? "" : category?.name,
    /\bchow mein\b/i.test(item.name) ? "noodles" : "",
    item.description === commonLunchDescription ? "" : item.description,
    item.vegetarian ? "vegetarian meatless" : "",
    item.containsPeanuts ? "contains peanuts" : "",
    item.heatLevel === 2 ? "extra spicy hot" : item.heatLevel === 1 ? "mild medium spicy hot" : item.spicy ? "spicy hot" : "",
    ...options.filter((option) => !option.isSide).map((option) => option.name),
  ];
  const dish = [...name, ...words(details.join(" "))];
  if (matches(dish)) return 3;
  const sides = options.filter((option) => option.isSide).map((option) => option.name);
  return matches([...dish, ...words([item.description, ...sides].join(" "))]) ? 1 : 0;
}

export function searchLunchMenu(items: readonly MenuItem[], category: string, text: string) {
  const query = words(text);
  const ranked = items
    .filter((item) => isLunchMenuItem(item) && item.available !== false && (category === "all" || item.categoryId === category))
    .map((item) => ({ item, score: relevance(item, query) }))
    .filter(({ score }) => score > 0);
  // A search for fried rice should lead to the entrée before offering it as a side.
  const minimum = ranked.some(({ score }) => score > 1) ? 2 : 1;
  return ranked.filter(({ score }) => score >= minimum)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.item.image)) - Number(Boolean(a.item.image)))
    .map(({ item }) => item);
}
