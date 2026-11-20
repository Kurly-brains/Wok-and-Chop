import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  parseCartLines,
  ContractError,
} from "../../../packages/contracts/src/index";
import { lunchMenuItems } from "../../../packages/domain/src/lunch-menu";
import { menuItems } from "../../../packages/domain/src/menu";
import type { MenuItem, PricedLine } from "../../../packages/domain/src/types";
import { DomainError, priceLine } from "../../../packages/domain/src/pricing";
import { quotePromo } from "../../../packages/domain/src/promotions";
import { validEmailAddress } from "./notifications";

const defaultCatalog = [...lunchMenuItems, ...menuItems];
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
  ) {
    throw new BadRequestException("Unexpected order fields.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = true) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim()) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BadRequestException(
      `Enter a valid ${label} (up to ${max} characters).`,
    );
  }
  return value.trim();
}

function basket(input: Record<string, unknown>) {
  try {
    return {
      lines: parseCartLines(input.lines).map((line) => ({
        ...line,
        modifierIds: [...line.modifierIds].sort(),
      })),
      promoCode: text(input.promoCode, "promo code", 24, false).toUpperCase(),
    };
  } catch (error) {
    if (error instanceof ContractError)
      throw new BadRequestException(error.message);
    throw error;
  }
}

export function pickupQuoteInput(body: unknown) {
  return basket(fields(body, ["lines", "promoCode"]));
}

export function pickupInput(body: unknown) {
  const input = fields(body, [
    "requestId",
    "name",
    "phone",
    "email",
    "lines",
    "promoCode",
    "expectedTotalCents",
    "quoteFingerprint",
    "expectedAccountId",
  ]);
  if (
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.requestId,
    )
  ) {
    throw new BadRequestException(
      "A fresh pickup request identifier is required.",
    );
  }
  if (
    typeof input.quoteFingerprint !== "string" ||
    !trackingFormat.test(input.quoteFingerprint)
  ) {
    throw new BadRequestException("Review a pickup quote before submitting.");
  }
  if (
    !Number.isSafeInteger(input.expectedTotalCents) ||
    (input.expectedTotalCents as number) < 0
  ) {
    throw new BadRequestException("Invalid reviewed total.");
  }
  const name = text(input.name, "name", 80);
  if (
    input.expectedAccountId !== undefined &&
    input.expectedAccountId !== null &&
    (typeof input.expectedAccountId !== "string" ||
      !uuid.test(input.expectedAccountId))
  ) {
    throw new BadRequestException("Invalid reviewed account session.");
  }
  const email = text(input.email, "email address", 254, false).toLowerCase();
  if (email && !validEmailAddress(email))
    throw new BadRequestException(
      "Enter a valid email address for pickup updates.",
    );
  const phone = text(input.phone, "phone number", 32)
    .replace(/[ ()+.\-]/g, "")
    .replace(/^1(?=\d{10}$)/, "");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(phone)) {
    throw new BadRequestException(
      "Enter a valid ten-digit contact phone number.",
    );
  }
  return {
    requestId: input.requestId.toLowerCase(),
    expectedAccountId:
      typeof input.expectedAccountId === "string"
        ? input.expectedAccountId.toLowerCase()
        : (input.expectedAccountId as null | undefined),
    expectedTotalCents: input.expectedTotalCents,
    quoteFingerprint: input.quoteFingerprint,
    contact: email ? { name, phone, email } : { name, phone },
    selection: basket(input),
  };
}

export function preparePickupQuote(
  selection: ReturnType<typeof pickupQuoteInput>,
  catalog: readonly MenuItem[] = defaultCatalog,
) {
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
        "This pickup exceeds the supported food order limit.",
      );
    const totals = {
      subtotalCents,
      discountCents,
      totalCents,
      deliveryCents: null,
      taxCents: null,
    };
    const quoteFingerprint = hash(
      JSON.stringify(["PICKUP", selection.promoCode, lines, totals]),
    );
    return { lines, totals, quoteFingerprint };
  } catch (error) {
    if (error instanceof DomainError)
      throw new BadRequestException(error.message);
    throw error;
  }
}

export function confirmedPickup(
  input: ReturnType<typeof pickupInput>,
  catalog: readonly MenuItem[] = defaultCatalog,
) {
  const quote = preparePickupQuote(input.selection, catalog);
  if (
    input.quoteFingerprint !== quote.quoteFingerprint ||
    input.expectedTotalCents !== quote.totals.totalCents
  ) {
    throw new ConflictException(
      "Your pickup quote has changed. Review the updated food total before submitting.",
    );
  }
  return {
    ...input.contact,
    ...quote.totals,
    lines: quote.lines,
    promoCode: input.selection.promoCode,
  };
}

export function reorderSelections(
  lines: readonly PricedLine[],
  catalog: readonly MenuItem[] = defaultCatalog,
) {
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
