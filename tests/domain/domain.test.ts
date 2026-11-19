import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateDiscount, assertRefundBudget, calculateAsapReadyAt, formatRestaurantTime, isSlotBookable, menuItems, multiplyRate, paymentStateFromLedger, previewTaxProfile, priceCart, priceLine, productionTicketEligible, recoverExpiredPrintLease, resolveTorontoLocalTime, transitionFulfillment } from '../../packages/domain/src/index';
import { parseQuoteRequest } from '../../packages/contracts/src/index';
import { renderKitchenTicket, sanitizeTicketText, wrapTicketText } from '../../packages/printing/src/index';

const now = new Date('2026-11-18T17:00:00.000Z');
const selection = { itemId: 'chilli-chicken', quantity: 2, modifierIds: ['spice-medium'] };

test('FR-019/023: strict request boundary rejects client price and payment tampering', () => {
  const valid = { lines: [selection], fulfillment: { type: 'PICKUP', timing: 'ASAP' } };
  assert.equal(parseQuoteRequest(valid).lines[0].quantity, 2);
  assert.throws(() => parseQuoteRequest({ ...valid, totalCents: 1 }), /unsupported/);
  assert.throws(() => parseQuoteRequest({ ...valid, lines: [{ ...selection, priceCents: 1 }] }), /unsupported/);
  assert.throws(() => parseQuoteRequest({ ...valid, fulfillment: { type: 'DELIVERY', timing: 'ASAP' } }), /pickup/);
  assert.throws(() => parseQuoteRequest({ ...valid, fulfillment: { type: 'PICKUP', timing: 'SCHEDULED', pickupAt: '2026-02-30T18:00:00Z' } }), /invalid/);
});

test('FR-003/004: required modifiers, quantities and availability are revalidated', () => {
  assert.equal(priceLine(selection, menuItems).lineTotalCents, 3390);
  assert.throws(() => priceLine({ ...selection, modifierIds: [] }, menuItems), /Spice level/);
  assert.throws(() => priceLine({ ...selection, modifierIds: ['spice-mild', 'spice-hot'] }, menuItems), /Spice level/);
  assert.throws(() => priceLine({ ...selection, modifierIds: ['spice-mild', 'spice-mild'] }, menuItems), /once/);
  assert.throws(() => priceLine({ ...selection, modifierIds: ['made-up'] }, menuItems), /belong/);
  assert.throws(() => priceLine({ ...selection, quantity: 1.5 }, menuItems), /quantity/);
  assert.throws(() => priceLine(selection, menuItems.map((item) => ({ ...item, available: false }))), /available/);
});

test('FR-019/021: exact cent rounding and deterministic discount allocation preserve totals', () => {
  assert.equal(multiplyRate(5, 1000), 1);
  assert.equal(multiplyRate(3000, 1300), 390);
  assert.deepEqual(allocateDiscount([100, 100, 100], 2), [1, 1, 0]);
  assert.deepEqual(allocateDiscount([199, 351, 450], 123), [25, 43, 55]);
  assert.throws(() => allocateDiscount([1], 2), /exceed/);
});

test('FR-008/020/021: snapshots are independent and fixture pricing cannot authorize production', () => {
  const catalog = [{ ...menuItems[0] }];
  const quote = priceCart([selection], catalog, { taxProfile: previewTaxProfile, now, preview: true });
  assert.equal(quote.totalCents, 3831);
  assert.equal(quote.expiresAt, '2026-11-18T17:05:00.000Z');
  catalog[0].priceCents = 1;
  catalog[0].name = 'Changed after checkout';
  assert.equal(quote.lines[0].name, 'Chilli chicken');
  assert.equal(quote.lines[0].basePriceCents, 1695);
  assert.throws(() => priceCart([selection], menuItems, { taxProfile: previewTaxProfile, now }), /Approved/);
  assert.throws(() => priceCart([selection], menuItems, { taxProfile: { ...previewTaxProfile, effectiveUntil: now.toISOString() }, now, preview: true }), /effective/);
});

test('FR-011: Toronto DST gaps are rejected and repeated hours require explicit resolution', () => {
  assert.throws(() => resolveTorontoLocalTime('2026-03-08T02:30'), /does not exist/);
  assert.throws(() => resolveTorontoLocalTime('2026-11-01T01:30'), /occurs twice/);
  assert.equal(resolveTorontoLocalTime('2026-11-01T01:30', 'earlier').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(resolveTorontoLocalTime('2026-11-01T01:30', 'later').toISOString(), '2026-11-01T06:30:00.000Z');
  assert.throws(() => resolveTorontoLocalTime('2026-02-30T12:00'), /invalid/);
  assert.match(formatRestaurantTime(now), /12:00/);
});

test('FR-010/011/012: a full checkout window and preparation lead fit before pickup', () => {
  assert.equal(isSlotBookable({ now, pickupAt: new Date('2026-11-18T17:49:00Z'), prepMinutes: 20, remainingCapacity: 1 }), false);
  assert.equal(isSlotBookable({ now, pickupAt: new Date('2026-11-18T17:50:00Z'), prepMinutes: 20, remainingCapacity: 1 }), true);
  assert.equal(isSlotBookable({ now, pickupAt: new Date('2026-11-18T18:00:00Z'), prepMinutes: 20, remainingCapacity: 0 }), false);
  assert.equal(calculateAsapReadyAt(now, 20).toISOString(), '2026-11-18T17:20:00.000Z');
});

test('FR-030/032/037: financial history stays independent from kitchen progression', () => {
  assert.equal(paymentStateFromLedger(1000, 0, false, true), 'PAID');
  assert.equal(paymentStateFromLedger(1000, 200, true), 'PARTIALLY_REFUNDED');
  assert.equal(transitionFulfillment('IN_PREPARATION', 'READY'), 'READY');
  assert.throws(() => transitionFulfillment('COMPLETED', 'ACCEPTED'), /Cannot move/);
  assert.throws(() => transitionFulfillment('AWAITING_PAYMENT', 'READY'), /Cannot move/);
  assertRefundBudget(1000, 200, 300, 500);
  assert.throws(() => assertRefundBudget(1000, 200, 300, 501), /exceed/);
});

test('FR-014/041/046: cancelled, unpaid and not-due production tickets stay ineligible', () => {
  const eligible = { canonicalCaptureVerified: true, fulfillment: 'ACCEPTED' as const, preparationReleaseAt: now, now };
  assert.equal(productionTicketEligible(eligible), true);
  assert.equal(productionTicketEligible({ ...eligible, fulfillment: 'CANCELLED' }), false);
  assert.equal(productionTicketEligible({ ...eligible, canonicalCaptureVerified: false }), false);
  assert.equal(productionTicketEligible({ ...eligible, preparationReleaseAt: new Date(now.getTime() + 1) }), false);
  assert.equal(recoverExpiredPrintLease('LEASED', true, true), 'RETRY_WAIT');
  assert.equal(recoverExpiredPrintLease('LEASED', true, false), 'UNKNOWN');
  assert.equal(recoverExpiredPrintLease('SENDING', true, true), 'UNKNOWN');
  assert.equal(recoverExpiredPrintLease('DELIVERED', false, false), 'DELIVERED');
});

test('FR-005/015/047: ticket control injection is removed and reprint/HOLD labels stay explicit', () => {
  assert.equal(sanitizeTicketText('<b>no nuts</b>\x1b@\x00\nplease'), 'no nuts @ please');
  assert.ok(wrapTicketText('An exceptionally long noodle name and a very long modifier description', 20).every((line) => Array.from(line).length <= 20));
  const ticket = { schemaVersion: 1 as const, orderNumber: 'D-12', ticketType: 'HOLD' as const, pickupLabel: '6:30 PM EST', station: 'Main kitchen', lines: [{ quantity: 2, name: 'Noodles', modifiers: ['Mild'], note: 'Peanut allergy', allergy: true }] };
  assert.match(renderKitchenTicket(ticket), /HOLD — DO NOT PREPARE/);
  assert.match(renderKitchenTicket(ticket), /ALLERGY NOTE/);
  assert.match(renderKitchenTicket({ ...ticket, ticketType: 'REPRINT', copyNumber: 2 }), /REPRINT — COPY 2/);
  assert.throws(() => renderKitchenTicket({ ...ticket, ticketType: 'REPRINT' }), /copy number/);
});
