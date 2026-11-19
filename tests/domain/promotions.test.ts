import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError, normalizePromoCode, quotePromo, type MenuItem } from '../../packages/domain/src/index';

function fixture(priceCents: number): MenuItem[] {
  return [{ id: 'fixture-food', name: 'Synthetic test dish', description: 'Arithmetic fixture', categoryId: 'test', priceCents, fixture: true }];
}
const selections = [{ itemId: 'fixture-food', quantity: 1 }];
const preview = { preview: true };
const hasCode = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;

test('Promo normalization accepts case and surrounding whitespace but rejects multiple codes', () => {
  assert.equal(normalizePromoCode('  wok10\n'), 'WOK10');
  assert.equal(quotePromo('  wOk10 ', selections, fixture(2000), preview).code, 'WOK10');
  assert.throws(() => quotePromo('WOK10 DEMO5', selections, fixture(3500), preview), hasCode('INVALID_PROMO_CODE'));
  assert.throws(() => quotePromo('WOK10,DEMO5', selections, fixture(3500), preview), hasCode('INVALID_PROMO_CODE'));
  assert.throws(() => quotePromo('', selections, fixture(3500), preview), hasCode('PROMO_CODE_REQUIRED'));
  assert.throws(() => quotePromo('UNKNOWN', selections, fixture(3500), preview), hasCode('PROMO_NOT_FOUND'));
});

test('WOK10 enforces its exact minimum, rounds half cents up and caps savings at $15', () => {
  assert.throws(() => quotePromo('WOK10', selections, fixture(1999), preview), /Add \$0.01 more/);
  assert.equal(quotePromo('WOK10', selections, fixture(2000), preview).discountCents, 200);
  assert.equal(quotePromo('WOK10', selections, fixture(2004), preview).discountCents, 200);
  assert.equal(quotePromo('WOK10', selections, fixture(2005), preview).discountCents, 201);
  assert.equal(quotePromo('WOK10', selections, fixture(15000), preview).discountCents, 1500);
  assert.equal(quotePromo('WOK10', selections, fixture(25000), preview).discountCents, 1500);
});

test('DEMO5 gives exactly $5 off at its $35 threshold and cannot make food totals negative', () => {
  assert.throws(() => quotePromo('DEMO5', selections, fixture(3499), preview), hasCode('PROMO_MINIMUM_NOT_MET'));
  const result = quotePromo('DEMO5', selections, fixture(3500), preview);
  assert.equal(result.discountCents, 500);
  assert.equal(result.foodTotalCents, 3000);
  assert.equal(result.subtotalCents, result.discountCents + result.foodTotalCents);
  assert.throws(() => quotePromo('DEMO5', selections, fixture(0), preview), hasCode('PROMO_MINIMUM_NOT_MET'));
});

test('Promo repricing ignores injected client amounts and revalidates the current menu', () => {
  const injected = [{ ...selections[0], subtotalCents: 999999, priceCents: 1, discountCents: 999999 }];
  assert.throws(() => quotePromo('WOK10', injected, fixture(1999), preview), hasCode('PROMO_MINIMUM_NOT_MET'));
  const result = quotePromo('WOK10', injected, fixture(2500), preview);
  assert.equal(result.subtotalCents, 2500);
  assert.equal(result.discountCents, 250);
  assert.throws(() => quotePromo('WOK10', selections, fixture(2500).map((item) => ({ ...item, available: false })), preview), hasCode('ITEM_UNAVAILABLE'));
  assert.throws(() => quotePromo('WOK10', [{ ...selections[0], quantity: -1 }], fixture(2500), preview), hasCode('INVALID_QUANTITY'));
});

test('Promo cent allocations preserve the discount exactly and never exceed a food line', () => {
  const catalog = [
    ...fixture(667),
    { ...fixture(1338)[0], id: 'fixture-food-two' },
  ];
  const result = quotePromo('WOK10', [...selections, { itemId: 'fixture-food-two', quantity: 1 }], catalog, preview);
  assert.equal(result.discountCents, 201);
  assert.deepEqual(result.discountAllocations, [67, 134]);
  assert.equal(result.discountAllocations.reduce((sum, amount) => sum + amount, 0), result.discountCents);
  assert.ok(result.discountAllocations.every((amount, index) => amount >= 0 && amount <= catalog[index].priceCents));
});

test('Fixture promotions fail closed outside explicit preview mode', () => {
  assert.throws(() => quotePromo('WOK10', selections, fixture(2000)), hasCode('PREVIEW_PROMOTION_ONLY'));
  assert.throws(() => quotePromo('DEMO5', selections, fixture(3500), { preview: false }), hasCode('PREVIEW_PROMOTION_ONLY'));
  const result = quotePromo('WOK10', selections, fixture(2000), preview);
  assert.equal(result.fixture, true);
  assert.equal(result.productionApplicable, false);
  assert.equal(result.currency, 'CAD');
  assert.throws(() => quotePromo('WOK10', [], fixture(2000), preview), hasCode('INVALID_CART'));
});
