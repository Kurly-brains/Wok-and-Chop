import type { CartSelection, MenuItem, PricedLine } from './types';

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}

function cents(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError('INVALID_MONEY', `${field} must be nonnegative integer cents.`);
  return value;
}

/** Nonnegative integer arithmetic with deterministic half-up rounding. */
export function multiplyRate(amountCents: number, basisPoints: number): number {
  cents(amountCents, 'Amount');
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new DomainError('INVALID_RATE', 'Rate must be between 0 and 10,000 basis points.');
  const result = Number((BigInt(amountCents) * BigInt(basisPoints) + 5_000n) / 10_000n);
  return cents(result, 'Rounded amount');
}

/** Allocate cents by largest remainder; ties retain original line order. */
export function allocateDiscount(lineAmounts: readonly number[], discountCents: number): number[] {
  lineAmounts.forEach((amount) => cents(amount, 'Line amount'));
  cents(discountCents, 'Discount');
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  cents(total, 'Subtotal');
  if (discountCents > total) throw new DomainError('DISCOUNT_EXCEEDS_SUBTOTAL', 'Discount cannot exceed the subtotal.');
  if (!total) return lineAmounts.map(() => 0);
  const denominator = BigInt(total);
  const shares = lineAmounts.map((amount, index) => {
    const numerator = BigInt(amount) * BigInt(discountCents);
    return { index, amount: Number(numerator / denominator), remainder: numerator % denominator };
  });
  const unallocated = discountCents - shares.reduce((sum, share) => sum + share.amount, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < unallocated; i++) ranked[i].amount += 1;
  return shares.map((share) => share.amount);
}

export function normalizeNote(note = ''): string {
  if (typeof note !== 'string' || note.length > 240) throw new DomainError('INVALID_NOTE', 'Notes must be 240 characters or fewer.');
  return note.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Uses only trusted catalog amounts; a customer's total is never accepted. */
export function priceLine(selection: CartSelection, catalog: readonly MenuItem[]): PricedLine {
  const item = catalog.find((entry) => entry.id === selection.itemId);
  if (!item || item.available === false) throw new DomainError('ITEM_UNAVAILABLE', 'This dish is no longer available.');
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 20) throw new DomainError('INVALID_QUANTITY', 'Choose a quantity from 1 to 20.');
  cents(item.priceCents, 'Base price');
  const selected = selection.modifierIds ?? [];
  if (new Set(selected).size !== selected.length) throw new DomainError('DUPLICATE_MODIFIER', 'An option can only be selected once.');
  const groups = item.modifierGroups ?? [];
  const validOptions = groups.flatMap((group) => group.options);
  if (selected.some((id) => !validOptions.some((option) => option.id === id))) throw new DomainError('INVALID_MODIFIER', 'An option does not belong to this dish.');
  for (const group of groups) {
    const count = group.options.filter((option) => selected.includes(option.id)).length;
    if (count < group.min || count > group.max) throw new DomainError('MODIFIER_REQUIRED', `${group.name}: choose ${group.min === group.max ? group.min : `${group.min}–${group.max}`} option(s).`);
  }
  const modifiers = selected.map((id) => {
    const option = validOptions.find((entry) => entry.id === id)!;
    if (option.available === false) throw new DomainError('MODIFIER_UNAVAILABLE', `${option.name} is unavailable.`);
    return { id: option.id, name: option.name, priceCents: cents(option.priceCents, 'Modifier price') };
  });
  const unitPriceCents = cents(item.priceCents + modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0), 'Unit price');
  return {
    itemId: item.id, name: item.name, quantity: selection.quantity,
    basePriceCents: item.priceCents, modifiers, unitPriceCents,
    lineTotalCents: cents(unitPriceCents * selection.quantity, 'Line total'),
    note: normalizeNote(selection.note),
  };
}

export interface TaxProfile {
  id: string;
  label: string;
  basisPoints: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  approved: boolean;
}

/** Arithmetic fixture only. This is not a Wok & Chop tax decision. */
export const previewTaxProfile: TaxProfile = {
  id: 'fixture-arithmetic-v1', label: 'Illustrative tax — not approved', basisPoints: 1300,
  effectiveFrom: '2020-01-01T00:00:00.000Z', approved: false,
};

export interface PriceCartOptions {
  taxProfile: TaxProfile;
  now: Date;
  preview?: boolean;
  discountCents?: number;
  tipCents?: number;
}

export function priceCart(selections: readonly CartSelection[], catalog: readonly MenuItem[], options: PriceCartOptions) {
  if (!selections.length || selections.length > 40) throw new DomainError('INVALID_CART', 'Choose between 1 and 40 cart lines.');
  if (!options.preview && (catalog.some((item) => item.fixture && selections.some((line) => line.itemId === item.id)) || !options.taxProfile.approved)) throw new DomainError('UNAPPROVED_CONFIGURATION', 'Approved restaurant menu and tax rules are required before taking payment.');
  const from = Date.parse(options.taxProfile.effectiveFrom);
  const until = options.taxProfile.effectiveUntil ? Date.parse(options.taxProfile.effectiveUntil) : Infinity;
  if (!Number.isFinite(from) || Number.isNaN(until) || !Number.isFinite(options.now.getTime()) || options.now.getTime() < from || options.now.getTime() >= until) throw new DomainError('TAX_PROFILE_EXPIRED', 'The tax profile is not effective for this quote.');
  const lines = selections.map((selection) => priceLine(selection, catalog));
  const subtotalCents = cents(lines.reduce((sum, line) => sum + line.lineTotalCents, 0), 'Subtotal');
  const discountCents = cents(options.discountCents ?? 0, 'Discount');
  const discountAllocations = allocateDiscount(lines.map((line) => line.lineTotalCents), discountCents);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = multiplyRate(taxableCents, options.taxProfile.basisPoints);
  const tipCents = cents(options.tipCents ?? 0, 'Voluntary tip');
  const totalCents = cents(taxableCents + taxCents + tipCents, 'Total');
  if (totalCents > 200_000) throw new DomainError('ORDER_LIMIT', 'This order exceeds the supported order limit.');
  return { currency: 'CAD' as const, preview: options.preview === true, lines, subtotalCents, discountCents, discountAllocations, taxableCents, taxCents, tipCents, totalCents, taxProfile: { ...options.taxProfile }, expiresAt: new Date(options.now.getTime() + 5 * 60_000).toISOString() };
}
