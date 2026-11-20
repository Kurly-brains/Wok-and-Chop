"use client";
import { useSyncExternalStore } from "react";
import { customLunchId, DomainError, isLunchMenuItem, priceLine, type CartSelection, type MenuItem } from "@wok/domain";
import { getMenuCatalogSnapshot, getPublishedMenuVersion, subscribeMenuCatalog } from "./menu-catalog";
export type CartLine = CartSelection & { key: string };
const KEY = "wok-chop-preview-cart-v1";
const EVENT = "wok-cart-changed";
const MAX_CART_LINES = 40;
const empty: CartLine[] = [];
let cached: CartLine[] = empty;
let awaitingMenu: CartLine[] = empty;
let lastRaw: string | null | undefined = undefined;
let memoryOnly = false;
let lastCatalog: ReturnType<typeof getMenuCatalogSnapshot> | undefined;
let lastPublishedVersion = 0;
function persist(raw: string) {
  try {
    localStorage.setItem(KEY, raw);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
}
function restoreLine(line: CartLine, catalog: readonly MenuItem[]): CartLine {
  const validated = priceLine(line, catalog);
  return {
    key: line.key,
    itemId: validated.itemId,
    quantity: validated.quantity,
    modifierIds: validated.modifiers.map((option) => option.id),
    note: validated.note,
  };
}

function pendingLunchLine(line: CartLine, catalog: readonly MenuItem[]) {
  const item = catalog.find((entry) => entry.id === line.itemId);
  if (!item || !isLunchMenuItem(item)) return null;
  try {
    // A published update can remove a group. Validate everything else until it arrives.
    return restoreLine(line, [{
      ...item,
      modifierGroups: item.modifierGroups?.map((group) => ({ ...group, min: 0 })),
    }]);
  } catch {
    return null;
  }
}

function snapshot(): CartLine[] {
  if (typeof window === "undefined") return empty;
  const menuItems = getMenuCatalogSnapshot();
  const publishedVersion = getPublishedMenuVersion();
  let raw: string | null;
  let readFailed = false;
  try {
    raw = memoryOnly ? (lastRaw ?? null) : localStorage.getItem(KEY);
  } catch {
    // A blocked read must not replace a known bag with an empty persisted bag.
    raw = lastRaw ?? JSON.stringify(cached);
    readFailed = true;
  }
  if (raw === lastRaw && menuItems === lastCatalog && publishedVersion === lastPublishedVersion) return cached;
  lastRaw = raw;
  lastCatalog = menuItems;
  lastPublishedVersion = publishedVersion;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    parsed = [];
  }
  const restored: CartLine[] = [];
  const waiting: CartLine[] = [];
  for (const value of (Array.isArray(parsed) ? parsed : []).slice(0, MAX_CART_LINES)) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.key !== "string" ||
      restored.some((line) => line.key === value.key) ||
      waiting.some((line) => line.key === value.key)
    )
      continue;
    if (!publishedVersion && typeof value.itemId === "string" && customLunchId.test(value.itemId)) {
      // A saved custom dish can predate the public menu response on reload.
      waiting.push(value);
      continue;
    }
    try {
      restored.push(restoreLine(value, menuItems));
    } catch (error) {
      /* Stale or tampered selections never enter the restored cart. */
      if (!publishedVersion && error instanceof DomainError && error.code === "MODIFIER_REQUIRED") {
        const pending = pendingLunchLine(value, menuItems);
        if (pending) waiting.push(pending);
      }
    }
  }
  cached = restored;
  awaitingMenu = waiting;
  const sanitized = JSON.stringify([...restored, ...waiting]);
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
  const pending = typeof update === "function" ? awaitingMenu : empty;
  if (next.length + pending.length > MAX_CART_LINES)
    throw new Error(`Your bag can hold up to ${MAX_CART_LINES} selections.`);
  next.forEach((line) => priceLine(line, getMenuCatalogSnapshot()));
  lastCatalog = getMenuCatalogSnapshot();
  lastPublishedVersion = getPublishedMenuVersion();
  cached = next;
  awaitingMenu = pending;
  lastRaw = JSON.stringify([...next, ...pending]);
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
