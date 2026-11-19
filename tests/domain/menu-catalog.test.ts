import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { isLunchMenuItem, priceLine } from "../../packages/domain/src/index";
import { getMenuCatalogSnapshot, MAX_MENU_IMAGE_BYTES, MENU_CATALOG_CHANGED_EVENT, MENU_CATALOG_STORAGE_KEY, resetCatalog, saveMenuItem, subscribeMenuCatalog, type MenuItemPatch } from "../../apps/web/lib/menu-catalog";

class PreviewStorage implements Storage {
  private values = new Map<string, string>();
  failWrites = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error("Quota exceeded"); this.values.set(key, value); }
  removeItem(key: string) { if (this.failWrites) throw new Error("Storage blocked"); this.values.delete(key); }
  clear() { this.values.clear(); }
}
let store: PreviewStorage;
let surface: EventTarget & { localStorage: PreviewStorage };
let originalWindow: PropertyDescriptor | undefined;
beforeEach(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  store = new PreviewStorage();
  surface = Object.assign(new EventTarget(), { localStorage: store });
  Object.defineProperty(globalThis, "window", { configurable: true, value: surface });
  resetCatalog();
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function pngData(bytes = 24) {
  const data = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  return `data:image/png;base64,${data.toString("base64")}`;
}

test("Preview catalog snapshots are stable and distinguish photos from cutouts", () => {
  const first = getMenuCatalogSnapshot();
  assert.equal(getMenuCatalogSnapshot(), first);
  assert.equal(first.length, 46);
  assert.equal(first.filter(isLunchMenuItem).length, 37);
  assert.equal(first.find((item) => item.id === "schezwan-fried-rice")?.imagePresentation, "photo");
  assert.equal(first.find((item) => item.id === "chilli-chicken")?.imagePresentation, "cutout");
  assert.equal(first.find((item) => item.id === "crispy-spring-rolls")?.imagePresentation, "cutout");
  assert.ok(first.every((item) => item.fixture));
  assert.ok(Object.isFrozen(first));
});

test("Catalog edits persist, notify subscribers and change trusted preview prices", () => {
  let notifications = 0;
  const unsubscribe = subscribeMenuCatalog(() => { notifications++; });
  const edited = saveMenuItem("crispy-spring-rolls", { name: "  Sample rolls  ", priceCents: 895, image: pngData(), imagePresentation: "cutout" });
  assert.equal(edited.name, "Sample rolls");
  assert.equal(edited.priceCents, 895);
  assert.equal(edited.fixture, true);
  assert.equal(notifications, 1);
  assert.equal(JSON.parse(store.getItem(MENU_CATALOG_STORAGE_KEY)!).version, 1);
  assert.equal(priceLine({ itemId: edited.id, quantity: 2 }, getMenuCatalogSnapshot()).lineTotalCents, 1790);
  saveMenuItem(edited.id, { available: false });
  assert.throws(() => priceLine({ itemId: edited.id, quantity: 1 }, getMenuCatalogSnapshot()), /available/);
  unsubscribe();
  surface.dispatchEvent(new Event(MENU_CATALOG_CHANGED_EVENT));
  assert.equal(notifications, 2);
});

test("Catalog rejects invalid fields, prices and image sources before changing storage", () => {
  const rejected: MenuItemPatch[] = [
    { name: "" }, { description: "x".repeat(401) }, { categoryId: "all" },
    { priceCents: 1.5 }, { priceCents: -1 }, { priceCents: 200001 },
    { image: "https://example.com/image.png" }, { image: "/images/../private.png" },
    { image: "/images/photo.jpg?x=1" }, { image: "data:image/svg+xml;base64,PHN2Zz4=" },
    { image: "data:image/png;base64,aGVsbG8=" },
  ];
  for (const patch of rejected) assert.throws(() => saveMenuItem("crispy-spring-rolls", patch));
  assert.throws(() => saveMenuItem("crispy-spring-rolls", { fixture: false } as MenuItemPatch), /cannot be edited/);
  assert.equal(store.getItem(MENU_CATALOG_STORAGE_KEY), null);
});

test("Image and total catalog byte limits preserve the last successful save", () => {
  const tooLarge = pngData(380000);
  assert.ok(tooLarge.length > MAX_MENU_IMAGE_BYTES);
  assert.throws(() => saveMenuItem("crispy-spring-rolls", { image: tooLarge }), /500 KB/);
  const permitted = pngData(350000);
  const ids = getMenuCatalogSnapshot().map((item) => item.id);
  for (const id of ids.slice(0, 5)) saveMenuItem(id, { image: permitted });
  const raw = store.getItem(MENU_CATALOG_STORAGE_KEY);
  assert.throws(() => saveMenuItem(ids[5], { image: permitted }), /2.5 MB/);
  assert.equal(store.getItem(MENU_CATALOG_STORAGE_KEY), raw);
});

test("Storage failure leaves current edits intact; reset restores default images and prices", () => {
  saveMenuItem("crispy-spring-rolls", { priceCents: 899, image: null });
  const saved = getMenuCatalogSnapshot();
  store.failWrites = true;
  assert.throws(() => saveMenuItem("crispy-spring-rolls", { priceCents: 199 }), /existing menu was kept/);
  assert.equal(getMenuCatalogSnapshot(), saved);
  assert.throws(() => resetCatalog(), /could not be reset/);
  store.failWrites = false;
  resetCatalog();
  const restored = getMenuCatalogSnapshot().find((item) => item.id === "crispy-spring-rolls")!;
  assert.equal(restored.priceCents, 695);
  assert.equal(restored.image, "/images/spring-rolls-cutout.webp");
});

test("Other-tab updates refresh catalog snapshots while malformed storage fails safely", () => {
  let notifications = 0;
  const unsubscribe = subscribeMenuCatalog(() => { notifications++; });
  store.setItem(MENU_CATALOG_STORAGE_KEY, JSON.stringify({ version: 1, overrides: { "crispy-spring-rolls": { priceCents: 799 } } }));
  const changed = new Event("storage");
  Object.defineProperty(changed, "key", { value: MENU_CATALOG_STORAGE_KEY });
  surface.dispatchEvent(changed);
  assert.equal(notifications, 1);
  assert.equal(getMenuCatalogSnapshot().find((item) => item.id === "crispy-spring-rolls")?.priceCents, 799);
  store.setItem(MENU_CATALOG_STORAGE_KEY, '{"version":999,"overrides":{}}');
  assert.equal(getMenuCatalogSnapshot().find((item) => item.id === "crispy-spring-rolls")?.priceCents, 695);
  assert.throws(() => saveMenuItem("crispy-spring-rolls", { priceCents: 900 }), /version is unsupported/);
  unsubscribe();
});

test("Lunch price, heat, peanut and featured overrides persist without changing legacy items", () => {
  const before = getMenuCatalogSnapshot();
  assert.equal(before.find((item) => item.id === "lunch-chilli-chicken")?.featured, true);
  const saved = saveMenuItem("lunch-chilli-chicken", {
    priceCents: 1599, heatLevel: 0, containsPeanuts: true, featured: false,
    image: "/images/chilli-chicken.jpg", imagePresentation: "photo", categoryId: "lunch-chicken",
  });
  assert.equal(saved.priceCents, 1599);
  assert.equal(saved.spicy, false);
  assert.equal(saved.heatLevel, 0);
  assert.equal(saved.containsPeanuts, true);
  assert.equal(saved.featured, false);
  assert.equal(saved.imagePresentation, "photo");
  assert.equal(getMenuCatalogSnapshot().find((item) => item.id === "chilli-chicken")?.priceCents, 1695);
  assert.throws(() => saveMenuItem(saved.id, { heatLevel: 3 } as unknown as MenuItemPatch), /0, 1 or 2/);
  assert.throws(() => saveMenuItem(saved.id, { featured: "yes" } as unknown as MenuItemPatch), /true or false/);
  assert.throws(() => saveMenuItem(saved.id, { containsPeanuts: 1 } as unknown as MenuItemPatch), /true or false/);
  resetCatalog();
  assert.equal(getMenuCatalogSnapshot().find((item) => item.id === saved.id)?.priceCents, 1399);
  assert.equal(getMenuCatalogSnapshot().find((item) => item.id === saved.id)?.featured, true);
});
