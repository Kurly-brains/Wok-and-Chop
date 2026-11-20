import { categories, menuItems } from "./menu";
import { customLunchId, lunchCategories, lunchMenuItems, lunchPreparationGroup, lunchSideGroup, lunchSoupOrPopGroup } from "./lunch-menu";
import type { MenuItem, ModifierGroup } from "./types";

export type MenuCatalogItem = MenuItem & {
  imagePresentation?: "photo" | "cutout";
  modifierGroupIds?: readonly string[];
};
export type CatalogMenuItem = MenuCatalogItem;
export type MenuItemPatch = Partial<
  Pick<MenuCatalogItem, "name" | "description" | "categoryId" | "priceCents" | "available" | "archived" | "imagePresentation" | "vegetarian" | "spicy" | "heatLevel" | "containsPeanuts" | "featured" | "modifierGroupIds">
> & { image?: string | null };
export type NewMenuItem = MenuItemPatch & Required<Pick<MenuItemPatch, "name" | "categoryId" | "priceCents">>;

export const MAX_MENU_IMAGE_BYTES = 500_000;
export const MAX_MENU_STORAGE_BYTES = 2_500_000;
const defaultImages: Record<string, Pick<MenuCatalogItem, "image" | "imagePresentation">> = {
  "chilli-chicken": { image: "/images/chicken-cutout.webp", imagePresentation: "cutout" },
  "hakka-noodles": { image: "/images/hakka-table.jpg", imagePresentation: "photo" },
  "crispy-spring-rolls": { image: "/images/spring-rolls-cutout.webp", imagePresentation: "cutout" },
  "chicken-hakka-noodles": { image: "/images/noodles-cutout.webp", imagePresentation: "cutout" },
  "schezwan-fried-rice": { image: "/images/schezwan-rice.jpg", imagePresentation: "photo" },
  "manchurian-cauliflower": { image: "/images/gobi-manchurian.jpg", imagePresentation: "photo" },
  "chilli-paneer": { image: "/images/chilli-paneer.jpg", imagePresentation: "photo" },
  "chicken-lollipops": { image: "/images/chicken-lollipops.jpg", imagePresentation: "photo" },
  "lunch-chilli-chicken": { image: "/images/chicken-cutout.webp", imagePresentation: "cutout" },
  "lunch-chicken-chow-mein": { image: "/images/noodles-cutout.webp", imagePresentation: "cutout" },
  "lunch-kung-pao-beef": { image: "/images/lunch-kung-pao-beef.webp", imagePresentation: "cutout" },
  "lunch-veg-manchurian": { image: "/images/lunch-veg-manchurian.webp", imagePresentation: "cutout" },
  "lunch-butter-chicken": { image: "/images/lunch-butter-chicken.jpg", imagePresentation: "photo" },
  "lunch-beef-broccoli": { image: "/images/lunch-beef-broccoli.jpg", imagePresentation: "photo" },
  "lunch-chilli-fish": { image: "/images/lunch-chilli-fish.jpg", imagePresentation: "photo" },
  "lunch-veg-fried-rice": { image: "/images/lunch-veg-fried-rice.jpg", imagePresentation: "photo" },
};

/** Local authoring preview only. This is never a production menu authority. */
export const defaultCatalog: readonly MenuCatalogItem[] = Object.freeze(
  [...menuItems, ...lunchMenuItems].map((item) => Object.freeze({ ...item, ...defaultImages[item.id], fixture: true as const })),
);
const categoryIds = new Set([...categories, ...lunchCategories].filter((category) => category.id !== "all").map((category) => category.id));
const allowedFields = new Set(["name", "description", "categoryId", "priceCents", "available", "archived", "image", "imagePresentation", "vegetarian", "spicy", "heatLevel", "containsPeanuts", "featured", "modifierGroupIds"]);
const knownModifierGroupIds = new Set(defaultCatalog.flatMap(item => item.modifierGroups?.map(group => group.id) ?? []));
export type Overrides = Record<string, MenuItemPatch>;

/** Omit id when authoring a new dish; packaged dishes retain their source choice groups. */
export function availableDishModifierGroups(item: { id?: string; categoryId: string }): readonly ModifierGroup[] {
  const packaged = defaultCatalog.find(candidate => candidate.id === item.id);
  if (packaged) return packaged.modifierGroups ?? [];
  if (item.id !== undefined && !customLunchId.test(item.id)) throw new Error("Unknown dish for menu choices.");
  if (!lunchCategories.some(category => category.id === item.categoryId)) throw new Error("Choose a lunch category before selecting menu choices.");
  return item.categoryId === "lunch-rice-noodles"
    ? [lunchSideGroup, lunchSoupOrPopGroup]
    : [lunchSideGroup, lunchSoupOrPopGroup, lunchPreparationGroup];
}

function selectedGroupIds(item: { id?: string; categoryId: string }, selected?: readonly string[]) {
  if (selected === undefined) return undefined;
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length) throw new Error("Choose each supported menu choice group at most once.");
  const available = availableDishModifierGroups(item);
  if (selected.some(id => !available.some(group => group.id === id))) throw new Error("One or more selected choice groups do not apply to this dish. Review its choices after changing category.");
  return Object.freeze(available.filter(group => selected.includes(group.id)).map(group => group.id));
}

const stockLunchDescriptions = new Set([
  "Includes jasmine rice, a vegetable spring roll, and soup of the day or pop.",
  "Includes jasmine rice and a vegetable spring roll.",
  "Includes a vegetable spring roll and soup of the day or pop.",
  "Includes a vegetable spring roll.",
]);

function withDishChoices(item: MenuCatalogItem): MenuCatalogItem {
  const ids = selectedGroupIds(item, item.modifierGroupIds);
  const groups = availableDishModifierGroups(item);
  const chosen = ids === undefined ? groups : groups.filter(group => ids.includes(group.id));
  let description = item.description;
  if (lunchMenuItems.some(candidate => candidate.id === item.id) && stockLunchDescriptions.has(description)) {
    const rice = chosen.some(group => group.id === "lunch-side");
    const soup = chosen.some(group => group.id === "lunch-soup-or-pop");
    description = rice && soup ? "Includes jasmine rice, a vegetable spring roll, and soup of the day or pop."
      : rice ? "Includes jasmine rice and a vegetable spring roll."
        : soup ? "Includes a vegetable spring roll and soup of the day or pop."
          : "Includes a vegetable spring roll.";
  }
  return Object.freeze({ ...item, description, ...(ids === undefined ? {} : { modifierGroupIds: ids }), modifierGroups: Object.freeze([...chosen]) });
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function textField(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || Array.from(trimmed).length > maximum) {
    throw new Error(`${field} must be ${allowEmpty ? "no more than" : "between 1 and"} ${maximum} characters.`);
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) throw new Error(`${field} cannot contain control characters or line breaks.`);
  return trimmed;
}

function validateImage(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Choose a local image path or upload a PNG, JPEG or WebP image.");
  const image = value.trim();
  if (image.startsWith("/images/")) {
    if (!/^\/images\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|avif)$/i.test(image) || image.includes("//") || image.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Use an image file under /images/ without path traversal, query strings or fragments.");
    }
    if (image.length > 240) throw new Error("Local image paths must be 240 characters or fewer.");
    return image;
  }
  if (byteLength(image) > MAX_MENU_IMAGE_BYTES) throw new Error("This image is too large for the preview. Use an image data URL smaller than 500 KB.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match || match[2].length % 4 !== 0) throw new Error("Upload a PNG, JPEG or WebP image. Remote image URLs and other data formats are not supported in this preview.");
  let header: string;
  try { header = atob(match[2].slice(0, 64)); } catch { throw new Error("The uploaded image data is invalid. Please choose the image again."); }
  const signatureMatches = match[1] === "png"
    ? header.startsWith("\x89PNG\r\n\x1a\n")
    : match[1] === "jpeg"
      ? header.startsWith("\xff\xd8\xff")
      : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  if (!signatureMatches) throw new Error("The uploaded file does not match its PNG, JPEG or WebP image type.");
  return image;
}

export function validatePatch(value: unknown): MenuItemPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Menu changes must be a valid field update.");
  const patch: MenuItemPatch = {};
  for (const [key, field] of Object.entries(value)) {
    if (!allowedFields.has(key)) throw new Error(`The field “${key}” cannot be edited in this preview.`);
    if (field === undefined) continue;
    switch (key) {
      case "name": patch.name = textField(field, "Dish name", 80); break;
      case "description": patch.description = textField(field, "Description", 400, true); break;
      case "categoryId":
        if (typeof field !== "string" || !categoryIds.has(field)) throw new Error("Choose one of the menu's food categories.");
        patch.categoryId = field;
        break;
      case "priceCents":
        if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0 || field > 200_000) throw new Error("Price must be whole CAD cents between 0 and 200,000 ($2,000).");
        patch.priceCents = field;
        break;
      case "available": case "archived": case "vegetarian": case "spicy": case "containsPeanuts": case "featured":
        if (typeof field !== "boolean") throw new Error(`${key} must be true or false.`);
        patch[key] = field;
        break;
      case "heatLevel":
        if (field !== 0 && field !== 1 && field !== 2) throw new Error("Heat level must be 0, 1 or 2.");
        patch.heatLevel = field;
        break;
      case "image": patch.image = validateImage(field); break;
      case "imagePresentation":
        if (field !== "photo" && field !== "cutout") throw new Error("Choose photo or cutout image presentation.");
        patch.imagePresentation = field;
        break;
      case "modifierGroupIds":
        if (!Array.isArray(field) || field.length > knownModifierGroupIds.size || field.some(id => typeof id !== "string" || !knownModifierGroupIds.has(id)) || new Set(field).size !== field.length) {
          throw new Error("Choose each supported menu choice group at most once.");
        }
        patch.modifierGroupIds = Object.freeze([...field]);
        break;
    }
  }
  if (patch.heatLevel !== undefined) patch.spicy = patch.heatLevel > 0;
  return patch;
}

export function validateNewMenuItem(value: unknown): NewMenuItem {
  const patch = validatePatch(value);
  if (!patch.name || patch.priceCents === undefined || patch.priceCents < 1 || !lunchCategories.some(category => category.id === patch.categoryId)) {
    throw new Error("Enter a dish name, a lunch category and a positive price.");
  }
  if (patch.modifierGroupIds !== undefined) patch.modifierGroupIds = selectedGroupIds({ categoryId: patch.categoryId! }, patch.modifierGroupIds);
  return patch as NewMenuItem;
}

export function createCustomMenuItem(id: string, input: NewMenuItem): MenuCatalogItem {
  if (!customLunchId.test(id)) throw new Error("Invalid custom lunch dish identifier.");
  const { image, ...fields } = input;
  return withDishChoices({
    description: "",
    available: true,
    vegetarian: input.categoryId === "lunch-vegetarian",
    ...fields,
    ...(image ? { image } : {}),
    id,
    fixture: true,
  });
}

export function applyMenuItemPatch(item: MenuCatalogItem, patch: MenuItemPatch): MenuCatalogItem {
  const { image, ...fields } = patch;
  const next: MenuCatalogItem = { ...item, ...fields, fixture: true };
  if (image === null) delete next.image;
  else if (image !== undefined) next.image = image;
  if (customLunchId.test(item.id)) {
    const { id, ...editable } = next;
    delete editable.modifierGroups;
    delete editable.fixture;
    return createCustomMenuItem(id, validateNewMenuItem(editable));
  }
  return withDishChoices(next);
}

export function buildCatalog(overrides: Overrides, customItems: readonly MenuCatalogItem[] = []): readonly MenuCatalogItem[] {
  if (!Object.keys(overrides).length && customItems.length === 0) return defaultCatalog;
  return Object.freeze([...defaultCatalog, ...customItems].map((item) => {
    const patch = overrides[item.id];
    if (!patch) return item;
    return applyMenuItemPatch(item, patch);
  }));
}
