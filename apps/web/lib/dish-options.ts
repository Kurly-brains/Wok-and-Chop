import { isDishAvailable, type MenuItem } from "@wok/domain";

export function dishOptionGroups(item: MenuItem) {
  return (item.modifierGroups ?? []).filter(
    (group) =>
      group.min > 0 ||
      (group.max > 0 &&
        group.options.some((option) => option.available !== false)),
  );
}

export function canAddDish(item: MenuItem) {
  return (
    isDishAvailable(item) &&
    (item.modifierGroups ?? []).every(
      (group) =>
        group.options.filter((option) => option.available !== false).length >=
        group.min,
    )
  );
}
