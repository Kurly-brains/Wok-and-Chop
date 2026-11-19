import type { CartSelection, MenuItem } from './types';
import { allocateDiscount, DomainError, multiplyRate, priceLine } from './pricing';
import { formatMoney } from './menu';

type PreviewPromotion = Readonly<{
  code: string;
  label: string;
  minimumSubtotalCents: number;
  fixture: true;
  productionApplicable: false;
} & (
  { type: 'PERCENTAGE'; basisPoints: number; maximumDiscountCents: number }
  | { type: 'FIXED'; amountCents: number }
)>;

/** Demonstration offers only; these are not approved restaurant promotions. */
export const promotionFixtures: readonly PreviewPromotion[] = Object.freeze([
  Object.freeze({ code: 'WOK10', label: 'Demo: 10% off food', type: 'PERCENTAGE' as const, basisPoints: 1000, minimumSubtotalCents: 2000, maximumDiscountCents: 1500, fixture: true as const, productionApplicable: false as const }),
  Object.freeze({ code: 'DEMO5', label: 'Demo: $5 off food', type: 'FIXED' as const, amountCents: 500, minimumSubtotalCents: 3500, fixture: true as const, productionApplicable: false as const }),
]);

export function normalizePromoCode(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('PROMO_CODE_REQUIRED', 'Enter a demo promo code.');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,24}$/.test(normalized)) throw new DomainError('INVALID_PROMO_CODE', 'Enter one demo code at a time, without spaces or punctuation.');
  return normalized;
}

/**
 * Reprices customer selections from the trusted catalog before applying one demo
 * offer. No client subtotal, discount or total is accepted. The food total excludes
 * taxes and tips; launch requires approved promotions and server tax treatment.
 */
export function quotePromo(
  rawCode: string,
  selections: readonly CartSelection[],
  catalog: readonly MenuItem[],
  options: { preview?: boolean } = {},
) {
  if (options.preview !== true) throw new DomainError('PREVIEW_PROMOTION_ONLY', 'Demo promo codes cannot be used for a live order.');
  const code = normalizePromoCode(rawCode);
  const promotion = promotionFixtures.find((entry) => entry.code === code);
  if (!promotion) throw new DomainError('PROMO_NOT_FOUND', 'That demo code was not found. Try WOK10 or DEMO5.');
  if (!selections.length || selections.length > 40) throw new DomainError('INVALID_CART', 'Add between 1 and 40 selections before applying a demo code.');
  const lines = selections.map((selection) => priceLine(selection, catalog));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new DomainError('INVALID_MONEY', 'The food subtotal is outside the supported range.');
  if (subtotalCents < promotion.minimumSubtotalCents) {
    throw new DomainError('PROMO_MINIMUM_NOT_MET', `${code} needs a food subtotal of ${formatMoney(promotion.minimumSubtotalCents)}. Add ${formatMoney(promotion.minimumSubtotalCents - subtotalCents)} more to use this demo code.`);
  }
  const discountCents = Math.min(subtotalCents, promotion.type === 'PERCENTAGE'
    ? Math.min(multiplyRate(subtotalCents, promotion.basisPoints), promotion.maximumDiscountCents)
    : promotion.amountCents);
  return {
    code, label: promotion.label, currency: 'CAD' as const,
    subtotalCents, discountCents, foodTotalCents: subtotalCents - discountCents,
    discountAllocations: allocateDiscount(lines.map((line) => line.lineTotalCents), discountCents),
    fixture: true as const, productionApplicable: false as const,
  };
}
