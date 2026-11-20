import { customLunchId, isDishAvailable, isLunchMenuItem, type MenuCatalogItem } from "@wok/domain";

function priority(item: MenuCatalogItem) {
  if (item.featured) return customLunchId.test(item.id) ? 0 : 1;
  return item.image ? 2 : 3;
}

export function featuredDishes(catalog: readonly MenuCatalogItem[]) {
  return catalog
    .filter(item => isLunchMenuItem(item) && isDishAvailable(item))
    .sort((left, right) => priority(left) - priority(right));
}

export function catalogDish(catalog: readonly MenuCatalogItem[], id: string) {
  return catalog.find(item => item.id === id && isDishAvailable(item));
}
