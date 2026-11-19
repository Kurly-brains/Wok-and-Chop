import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  parseCartLines,
  ContractError,
} from "../../../packages/contracts/src/index";
import { lunchMenuItems } from "../../../packages/domain/src/lunch-menu";
import { menuItems } from "../../../packages/domain/src/menu";
import type { MenuItem } from "../../../packages/domain/src/types";
import { DomainError, priceLine } from "../../../packages/domain/src/pricing";
import { quotePromo } from "../../../packages/domain/src/promotions";

const defaultCatalog = [...lunchMenuItems, ...menuItems];
const ontarioFsa = /^[KLMNP]\d[ABCEGHJ-NPRSTV-Z]$/;
const canadaLetter = /^[ABCEGHJ-NPRSTV-Z]$/;
export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const trackingFormat = /^[0-9a-f]{64}$/;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function fields(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new BadRequestException("Unexpected delivery fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim()) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new BadRequestException(
      `Enter a valid ${label} (up to ${max} characters).`,
    );
  return value.trim();
}
export function postalPrefixes() {
  const value = process.env.DELIVERY_POSTAL_PREFIXES?.trim();
  if (!value) return [];
  const codes = value
    .toUpperCase()
    .split(",")
    .map((code) => code.trim());
  if (!codes.every((code) => ontarioFsa.test(code)))
    throw new Error("Invalid local delivery postal-prefix configuration.");
  return [...new Set(codes)];
}
function postal(value: unknown) {
  const code = text(value, "Ontario postal code", 7).toUpperCase();
  const compact = code.replace(" ", "");
  if (
    !/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact) ||
    !ontarioFsa.test(compact.slice(0, 3)) ||
    !canadaLetter.test(compact[4])
  )
    throw new BadRequestException("Enter a valid Ontario postal code.");
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}
function basket(input: Record<string, unknown>, code: unknown) {
  try {
    return {
      lines: parseCartLines(input.lines).map((line) => ({
        ...line,
        modifierIds: [...line.modifierIds].sort(),
      })),
      promoCode: text(input.promoCode, "promo code", 24, false).toUpperCase(),
      postalCode: postal(code),
    };
  } catch (error) {
    if (error instanceof ContractError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
export function quoteInput(body: unknown) {
  const input = fields(body, ["lines", "promoCode", "postalCode"]);
  return basket(input, input.postalCode);
}
export function orderInput(body: unknown) {
  const input = fields(body, [
    "requestId",
    "name",
    "phone",
    "address",
    "instructions",
    "lines",
    "promoCode",
    "expectedTotalCents",
    "quoteFingerprint",
  ]);
  if (
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.requestId,
    )
  )
    throw new BadRequestException(
      "A fresh delivery request identifier is required.",
    );
  if (
    typeof input.quoteFingerprint !== "string" ||
    !trackingFormat.test(input.quoteFingerprint)
  )
    throw new BadRequestException("Review a delivery quote before submitting.");
  if (
    input.expectedTotalCents !== undefined &&
    (!Number.isSafeInteger(input.expectedTotalCents) ||
      (input.expectedTotalCents as number) < 0)
  )
    throw new BadRequestException("Invalid reviewed total.");
  const address = fields(input.address, [
    "street",
    "unit",
    "city",
    "province",
    "postalCode",
  ]);
  if (address.province !== "ON")
    throw new BadRequestException(
      "The local delivery preview accepts Ontario addresses.",
    );
  const name = text(input.name, "name", 80);
  const phone = text(input.phone, "phone number", 32)
    .replace(/[ ()+.\-]/g, "")
    .replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(phone))
    throw new BadRequestException(
      "Enter a valid ten-digit contact phone number.",
    );
  const selection = basket(input, address.postalCode);
  return {
    requestId: input.requestId.toLowerCase(),
    expectedTotalCents: input.expectedTotalCents,
    quoteFingerprint: input.quoteFingerprint,
    selection,
    contact: {
      name,
      phone,
      instructions: text(
        typeof input.instructions === "string"
          ? input.instructions.replace(/\r?\n/g, " ")
          : input.instructions,
        "delivery instructions",
        400,
        false,
      ),
      address: {
        street: text(address.street, "street address", 140),
        unit: text(address.unit, "unit", 40, false),
        city: text(address.city, "city", 80),
        province: "ON",
        postalCode: selection.postalCode,
      },
    },
  };
}
export function prepareQuote(selection: ReturnType<typeof quoteInput>, catalog: readonly MenuItem[] = defaultCatalog) {
  const areas = postalPrefixes();
  if (areas.length && !areas.includes(selection.postalCode.slice(0, 3)))
    throw new BadRequestException(
      "This postal code is outside the configured delivery area.",
    );
  try {
    const lines = selection.lines.map((line) => priceLine(line, catalog));
    const subtotalCents = lines.reduce(
      (sum, line) => sum + line.lineTotalCents,
      0,
    );
    const discountCents = selection.promoCode
      ? quotePromo(selection.promoCode, selection.lines, catalog, {
          preview: true,
        }).discountCents
      : 0;
    const totalCents = subtotalCents - discountCents;
    if (totalCents > 200000)
      throw new BadRequestException(
        "This delivery exceeds the supported food order limit.",
      );
    const totals = {
      subtotalCents,
      discountCents,
      totalCents,
      deliveryCents: null,
      taxCents: null,
    };
    const quoteFingerprint = hash(
      JSON.stringify([
        selection.postalCode,
        selection.promoCode,
        lines,
        totals,
      ]),
    );
    return { lines, totals, quoteFingerprint };
  } catch (error) {
    if (error instanceof DomainError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
export function confirmedSnapshot(input: ReturnType<typeof orderInput>, catalog: readonly MenuItem[] = defaultCatalog) {
  const quote = prepareQuote(input.selection, catalog);
  if (
    input.quoteFingerprint !== quote.quoteFingerprint ||
    (input.expectedTotalCents !== undefined &&
      input.expectedTotalCents !== quote.totals.totalCents)
  )
    throw new ConflictException(
      "Your delivery quote has changed. Review the updated food total before submitting.",
    );
  return {
    ...input.contact,
    ...quote.totals,
    lines: quote.lines,
    promoCode: input.selection.promoCode,
  };
}

export function reorderSelections(lines: ReturnType<typeof confirmedSnapshot>["lines"], catalog: readonly MenuItem[] = defaultCatalog) {
  const selections = lines.flatMap((line) => {
    const selection = {
      itemId: line.itemId,
      quantity: line.quantity,
      modifierIds: line.modifiers.map((option) => option.id),
    };
    try {
      priceLine(selection, catalog);
      return [selection];
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return [];
    }
  });
  return { selections, unavailable: lines.length - selections.length };
}
