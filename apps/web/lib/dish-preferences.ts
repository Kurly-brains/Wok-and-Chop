import { priceLine, type MenuItem } from "@wok/domain";

export function dishPreferenceKey(itemId: string, accountId?: string) {
  return `wok-chop:dish-options:${accountId ?? "guest"}:${itemId}`;
}

export function readDishPreference(
  item: MenuItem,
  accountId?: string,
): readonly string[] | null {
  try {
    const saved = localStorage.getItem(dishPreferenceKey(item.id, accountId));
    if (saved === null) return null;
    const options: unknown = JSON.parse(saved);
    if (
      !Array.isArray(options) ||
      options.some((id: unknown) => typeof id !== "string")
    )
      return null;
    const validated = priceLine(
      { itemId: item.id, quantity: 1, modifierIds: options },
      [item],
    );
    return validated.modifiers.map((option) => option.id);
  } catch {
    return null;
  }
}

export function writeDishPreference(
  key: string,
  options: readonly string[] | null,
) {
  try {
    if (options === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(options));
    return true;
  } catch {
    return false;
  }
}
