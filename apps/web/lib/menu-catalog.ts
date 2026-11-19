"use client";
import { useEffect, useSyncExternalStore } from "react";
import { buildCatalog, byteLength, defaultCatalog, MAX_MENU_STORAGE_BYTES, validatePatch, type MenuCatalogItem, type MenuItemPatch, type Overrides } from "@wok/domain";
import { API_URL } from "./customer-session";
export { MAX_MENU_IMAGE_BYTES, MAX_MENU_STORAGE_BYTES, type MenuCatalogItem, type CatalogMenuItem, type MenuItemPatch } from "@wok/domain";

export const MENU_CATALOG_STORAGE_KEY = "wok-chop-preview-menu-v1";
export const MENU_CATALOG_CHANGED_EVENT = "wok-menu-catalog-changed";
const STORAGE_VERSION = 1;
let cachedRaw: string | null | undefined;
let cachedCatalog = defaultCatalog;
let publishedCatalog: readonly MenuCatalogItem[] | null = null;
let publishedVersion = 0;
let refreshPending: Promise<boolean> | null = null;

function parseOverrides(raw: string | null): Overrides {
  if (!raw) return Object.create(null) as Overrides;
  if (byteLength(raw) > MAX_MENU_STORAGE_BYTES) throw new Error("The saved preview menu exceeds the 2.5 MB storage limit. Reset the sample menu before saving.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("The saved preview menu cannot be read. Reset the sample menu before saving."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The saved preview menu has an invalid format. Reset it before saving.");
  const envelope = parsed as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => key !== "version" && key !== "overrides") || envelope.version !== STORAGE_VERSION || !envelope.overrides || typeof envelope.overrides !== "object" || Array.isArray(envelope.overrides)) throw new Error("The saved preview menu version is unsupported. Reset the sample menu before saving.");
  const result: Overrides = Object.create(null) as Overrides;
  for (const [id, patch] of Object.entries(envelope.overrides)) {
    if (!defaultCatalog.some((item) => item.id === id)) throw new Error("The saved preview menu contains an unknown dish. Reset the sample menu before saving.");
    result[id] = validatePatch(patch);
  }
  return result;
}

function getDraftMenuSnapshot(): readonly MenuCatalogItem[] {
  if (typeof window === "undefined") return defaultCatalog;
  let raw: string | null;
  try { raw = window.localStorage.getItem(MENU_CATALOG_STORAGE_KEY); } catch { return cachedCatalog; }
  if (raw === cachedRaw) return cachedCatalog;
  cachedRaw = raw;
  try { cachedCatalog = buildCatalog(parseOverrides(raw)); } catch { cachedCatalog = defaultCatalog; }
  return cachedCatalog;
}

export function subscribeMenuCatalog(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === MENU_CATALOG_STORAGE_KEY || event.key === null) callback();
  };
  window.addEventListener(MENU_CATALOG_CHANGED_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MENU_CATALOG_CHANGED_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function getMenuCatalogSnapshot(): readonly MenuCatalogItem[] {
  return publishedCatalog ?? getDraftMenuSnapshot();
}

export function refreshPublishedMenu(): Promise<boolean> {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    try {
      const response = await fetch(`${API_URL}/v1/menu?after=${publishedVersion}`, { cache: "no-store" });
      if (!response.ok) return false;
      const data = await response.json() as { version: number; overrides: Overrides | null };
      if (!Number.isSafeInteger(data.version) || data.version < 1) return false;
      if (data.overrides && typeof data.overrides === "object" && !Array.isArray(data.overrides)) {
        const overrides = Object.fromEntries(Object.entries(data.overrides).map(([id, patch]) => [id, validatePatch(patch)]));
        publishedCatalog = buildCatalog(overrides);
        publishedVersion = data.version;
        window.dispatchEvent(new Event(MENU_CATALOG_CHANGED_EVENT));
      }
      return publishedVersion === data.version;
    } catch {
      return false;
    } finally {
      refreshPending = null;
    }
  })();
  return refreshPending;
}

export function useMenuCatalog(): readonly MenuCatalogItem[] {
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void refreshPublishedMenu(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(subscribeMenuCatalog, getMenuCatalogSnapshot, () => defaultCatalog);
}

async function updatePublishedMenu(route: string, change: Record<string, unknown>) {
  if (!publishedVersion) throw new Error("Connect the local menu service before publishing.");
  const response = await fetch(`${API_URL}/v1/auth/admin/menu/${route}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion: publishedVersion, ...change }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status === 409) await refreshPublishedMenu();
    throw new Error(typeof error?.message === "string" ? error.message : "The menu could not be published.");
  }
  // A read already in flight may have started before the write was committed.
  if (refreshPending) await refreshPending;
  if (!await refreshPublishedMenu()) {
    throw new Error("Your changes were saved. Reload the page to see the published menu.");
  }
}

export async function publishMenuItem(id: string, patch: MenuItemPatch): Promise<MenuCatalogItem> {
  await updatePublishedMenu(`items/${encodeURIComponent(id)}`, { patch: validatePatch(patch) });
  return getMenuCatalogSnapshot().find(item => item.id === id)!;
}

export function resetPublishedMenu() {
  return updatePublishedMenu("reset", {});
}

export function saveMenuItem(id: string, patch: MenuItemPatch): MenuCatalogItem {
  if (typeof window === "undefined") throw new Error("Menu editing is available in the browser preview only.");
  if (!defaultCatalog.some((item) => item.id === id)) throw new Error("This dish is not part of the sample menu.");
  const normalized = validatePatch(patch);
  let raw: string | null;
  try { raw = window.localStorage.getItem(MENU_CATALOG_STORAGE_KEY); } catch { throw new Error("Browser storage is unavailable. Allow local site storage to save preview menu changes."); }
  const overrides = parseOverrides(raw);
  overrides[id] = { ...overrides[id], ...normalized };
  const nextRaw = JSON.stringify({ version: STORAGE_VERSION, overrides });
  if (byteLength(nextRaw) > MAX_MENU_STORAGE_BYTES) throw new Error("The preview menu would exceed 2.5 MB. Use smaller images or remove an uploaded image before saving.");
  try { window.localStorage.setItem(MENU_CATALOG_STORAGE_KEY, nextRaw); } catch { throw new Error("The menu could not be saved to browser storage. Free up site storage or use smaller images; your existing menu was kept."); }
  cachedRaw = nextRaw;
  cachedCatalog = buildCatalog(overrides);
  window.dispatchEvent(new Event(MENU_CATALOG_CHANGED_EVENT));
  return cachedCatalog.find((item) => item.id === id)!;
}

export function resetCatalog(): void {
  if (typeof window === "undefined") throw new Error("Menu editing is available in the browser preview only.");
  try { window.localStorage.removeItem(MENU_CATALOG_STORAGE_KEY); } catch { throw new Error("The sample menu could not be reset because browser storage is unavailable."); }
  cachedRaw = null;
  cachedCatalog = defaultCatalog;
  window.dispatchEvent(new Event(MENU_CATALOG_CHANGED_EVENT));
}
