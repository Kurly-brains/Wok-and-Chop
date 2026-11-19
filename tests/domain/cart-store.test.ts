import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { priceLine } from "../../packages/domain/src/index";
import {
  getCartSnapshot,
  setCart,
  subscribeCart,
  type CartLine,
} from "../../apps/web/lib/cart-store";
import {
  getMenuCatalogSnapshot,
  resetCatalog,
  saveMenuItem,
} from "../../apps/web/lib/menu-catalog";

const CART_KEY = "wok-chop-preview-cart-v1";
class CartStorage implements Storage {
  private values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  writes = 0;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) {
    if (this.failReads) throw new Error("Storage blocked");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes++;
    if (this.failWrites) throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
let storage: CartStorage;
let surface: EventTarget & { localStorage: CartStorage };
let originalWindow: PropertyDescriptor | undefined;
let originalStorage: PropertyDescriptor | undefined;
const rolls: CartLine = {
  key: "rolls-kept-key", itemId: "crispy-spring-rolls", quantity: 2,
  modifierIds: [], note: "Pack separately",
};
const noodles: CartLine = {
  key: "noodles-kept-key", itemId: "hakka-noodles", quantity: 1,
  modifierIds: ["spice-mild"], note: "",
};
beforeEach(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  storage = new CartStorage();
  surface = Object.assign(new EventTarget(), { localStorage: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: surface });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  resetCatalog();
  setCart([]);
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("Unavailable cart lines are removed from persistence and cannot reappear", () => {
  setCart([rolls, noodles]);
  saveMenuItem(rolls.itemId, { available: false });
  assert.deepEqual(getCartSnapshot(), [noodles]);
  assert.deepEqual(JSON.parse(storage.getItem(CART_KEY)!), [noodles]);
  saveMenuItem(rolls.itemId, { available: true });
  assert.deepEqual(getCartSnapshot(), [noodles]);
  assert.equal(getCartSnapshot()[0].key, noodles.key);
});

test("Failed sanitization writes keep the remaining bag in memory without resurrection", () => {
  setCart([rolls, noodles]);
  saveMenuItem(rolls.itemId, { available: false });
  storage.failWrites = true;
  assert.deepEqual(getCartSnapshot(), [noodles]);
  assert.equal(JSON.parse(storage.getItem(CART_KEY)!).length, 2);
  storage.failWrites = false;
  saveMenuItem(rolls.itemId, { available: true });
  assert.deepEqual(getCartSnapshot(), [noodles]);
  setCart((current) => current);
  assert.deepEqual(JSON.parse(storage.getItem(CART_KEY)!), [noodles]);
});

test("A recovered cart write resumes storage reads and cross-tab quantity changes", () => {
  storage.failWrites = true;
  setCart([rolls]);
  assert.equal(getCartSnapshot()[0].quantity, 2);
  storage.failWrites = false;
  setCart((current) => current.map((line) => ({ ...line, quantity: 3 })));
  let notifications = 0;
  const unsubscribe = subscribeCart(() => { notifications++; });
  storage.setItem(CART_KEY, JSON.stringify([{ ...rolls, quantity: 4 }]));
  surface.dispatchEvent(new Event("storage"));
  assert.ok(notifications > 0);
  assert.equal(getCartSnapshot()[0].quantity, 4);
  assert.equal(getCartSnapshot()[0].key, rolls.key);
  setCart((current) => current.filter((line) => line.key !== rolls.key));
  assert.deepEqual(getCartSnapshot(), []);
  assert.deepEqual(JSON.parse(storage.getItem(CART_KEY)!), []);
  unsubscribe();
});

test("A blocked storage read retains the known bag and never writes an empty replacement", () => {
  setCart([rolls]);
  const snapshot = getCartSnapshot();
  const writes = storage.writes;
  storage.failReads = true;
  assert.equal(getCartSnapshot(), snapshot);
  assert.equal(storage.writes, writes);
  storage.failReads = false;
  assert.deepEqual(JSON.parse(storage.getItem(CART_KEY)!), [rolls]);
  storage.setItem(CART_KEY, JSON.stringify([{ ...rolls, quantity: 3 }]));
  assert.equal(getCartSnapshot()[0].quantity, 3);
});

test("Restoration rejects tampered quantities and reprices preserved selections from the catalog", () => {
  storage.setItem(CART_KEY, JSON.stringify([
    { ...rolls, quantity: 0 },
    { ...noodles, priceCents: 1, lineTotalCents: 1 },
  ]));
  assert.deepEqual(getCartSnapshot(), [noodles]);
  saveMenuItem(noodles.itemId, { priceCents: 1799 });
  assert.equal(priceLine(getCartSnapshot()[0], getMenuCatalogSnapshot()).lineTotalCents, 1799);
  assert.throws(() => setCart([{ ...noodles, quantity: 21 }]), /quantity/i);
  assert.deepEqual(getCartSnapshot(), [noodles]);
  assert.deepEqual(JSON.parse(storage.getItem(CART_KEY)!), [noodles]);
});
