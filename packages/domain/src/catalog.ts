import { categories, menuItems } from "./menu";
import { lunchCategories, lunchMenuItems } from "./lunch-menu";
import type { MenuItem } from "./types";

export type MenuCatalogItem = MenuItem & {
  imagePresentation?: "photo" | "cutout";
};
export type CatalogMenuItem = MenuCatalogItem;
export type MenuItemPatch = Partial<
  Pick<MenuCatalogItem, "name" | "description" | "categoryId" | "priceCents" | "available" | "imagePresentation" | "vegetarian" | "spicy" | "heatLevel" | "containsPeanuts" | "featured">
> & { image?: string | null };

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
const allowedFields = new Set(["name", "description", "categoryId", "priceCents", "available", "image", "imagePresentation", "vegetarian", "spicy", "heatLevel", "containsPeanuts", "featured"]);
export type Overrides = Record<string, MenuItemPatch>;

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
      case "available": case "vegetarian": case "spicy": case "containsPeanuts": case "featured":
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
    }
  }
  if (patch.heatLevel !== undefined) patch.spicy = patch.heatLevel > 0;
  return patch;
}

export function buildCatalog(overrides: Overrides): readonly MenuCatalogItem[] {
  if (!Object.keys(overrides).length) return defaultCatalog;
  return Object.freeze(defaultCatalog.map((item) => {
    const patch = overrides[item.id];
    if (!patch) return item;
    const { image, ...fields } = patch;
    const next: MenuCatalogItem = { ...item, ...fields, fixture: true };
    if (image === null) delete next.image;
    else if (image !== undefined) next.image = image;
    return Object.freeze(next);
  }));
}
