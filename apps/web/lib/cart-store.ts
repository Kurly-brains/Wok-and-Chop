"use client";
import { useSyncExternalStore } from "react";
import { priceLine, normalizeNote, type CartSelection } from "@wok/domain";
import { getMenuCatalogSnapshot, subscribeMenuCatalog } from "./menu-catalog";
export type CartLine = CartSelection & { key: string };
const KEY = "wok-chop-preview-cart-v1";
const EVENT = "wok-cart-changed";
const empty: CartLine[] = [];
let cached: CartLine[] = empty;
let lastRaw: string | null | undefined = undefined;
let memoryOnly = false;
let lastCatalog: ReturnType<typeof getMenuCatalogSnapshot> | undefined;
function persist(raw: string) {
  try {
    localStorage.setItem(KEY, raw);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
}
function snapshot(): CartLine[] {
  if (typeof window === "undefined") return empty;
  const menuItems = getMenuCatalogSnapshot();
  let raw: string | null;
  let readFailed = false;
  try {
    raw = memoryOnly ? (lastRaw ?? null) : localStorage.getItem(KEY);
  } catch {
    // A blocked read must not replace a known bag with an empty persisted bag.
    raw = lastRaw ?? JSON.stringify(cached);
    readFailed = true;
  }
  if (raw === lastRaw && menuItems === lastCatalog) return cached;
  lastRaw = raw;
  lastCatalog = menuItems;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    parsed = [];
  }
  const restored: CartLine[] = [];
  for (const value of (Array.isArray(parsed) ? parsed : []).slice(0, 40)) {
    try {
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.key !== "string" ||
        restored.some((line) => line.key === value.key)
      )
        continue;
      const validated = priceLine(value, menuItems);
      restored.push({
        key: value.key,
        itemId: validated.itemId,
        quantity: validated.quantity,
        modifierIds: validated.modifiers.map((option) => option.id),
        note: normalizeNote(validated.note),
      });
    } catch {
      /* Stale or tampered selections never enter the restored cart. */
    }
  }
  cached = restored;
  const sanitized = JSON.stringify(restored);
  if (raw !== null && sanitized !== raw) {
    // Removed unavailable lines must not reappear after a later catalog change.
    lastRaw = sanitized;
    if (readFailed) memoryOnly = true;
    else persist(sanitized);
  }
  return cached;
}
function subscribe(callback: () => void) {
  const unsubscribeCatalog = subscribeMenuCatalog(callback);
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    unsubscribeCatalog();
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function setCart(update: CartLine[] | ((current: CartLine[]) => CartLine[])) {
  const next = typeof update === "function" ? update(snapshot()) : update;
  next.forEach((line) => priceLine(line, getMenuCatalogSnapshot()));
  lastCatalog = getMenuCatalogSnapshot();
  cached = next;
  lastRaw = JSON.stringify(next);
  persist(lastRaw);
  window.dispatchEvent(new Event(EVENT));
}
export { snapshot as getCartSnapshot, setCart, subscribe as subscribeCart };
export function useCart() {
  return [
    useSyncExternalStore(subscribe, snapshot, () => empty),
    setCart,
  ] as const;
}
