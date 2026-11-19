import type { FulfillmentState, PaymentState, PrintState } from './types';
import { DomainError } from './pricing';

const fulfillmentTransitions: Record<FulfillmentState, readonly FulfillmentState[]> = {
  AWAITING_PAYMENT: ['ACCEPTED', 'SCHEDULED', 'CANCELLED', 'EXCEPTION'],
  ACCEPTED: ['IN_PREPARATION', 'CANCELLED', 'EXCEPTION'],
  SCHEDULED: ['ACCEPTED', 'CANCELLED', 'EXCEPTION'],
  IN_PREPARATION: ['READY', 'CANCELLED', 'EXCEPTION'],
  READY: ['COMPLETED', 'CANCELLED', 'EXCEPTION'],
  COMPLETED: [], CANCELLED: [], EXCEPTION: ['ACCEPTED', 'SCHEDULED', 'CANCELLED'],
};

export function canTransitionFulfillment(from: FulfillmentState, to: FulfillmentState): boolean {
  return from === to || fulfillmentTransitions[from].includes(to);
}
export function transitionFulfillment(from: FulfillmentState, to: FulfillmentState): FulfillmentState {
  if (!canTransitionFulfillment(from, to)) throw new DomainError('INVALID_TRANSITION', `Cannot move fulfillment from ${from} to ${to}.`);
  return to;
}

/** Pure financial projection; it never changes fulfillment or print state. */
export function paymentStateFromLedger(capturedCents: number, succeededRefundCents: number, unresolvedAttempt: boolean, failedAttempt = false): PaymentState {
  if (![capturedCents, succeededRefundCents].every((value) => Number.isSafeInteger(value) && value >= 0) || succeededRefundCents > capturedCents) throw new DomainError('INVALID_LEDGER', 'Refunds cannot exceed the captured amount.');
  if (capturedCents > 0) return succeededRefundCents === capturedCents ? 'REFUNDED' : succeededRefundCents > 0 ? 'PARTIALLY_REFUNDED' : 'PAID';
  return unresolvedAttempt ? 'PROCESSING' : failedAttempt ? 'FAILED' : 'UNPAID';
}

export function assertRefundBudget(captured: number, succeeded: number, pending: number, requested: number): void {
  if (![captured, succeeded, pending, requested].every((value) => Number.isSafeInteger(value) && value >= 0) || requested === 0 || BigInt(succeeded) + BigInt(pending) + BigInt(requested) > BigInt(captured)) throw new DomainError('REFUND_LIMIT', 'Successful and pending refunds plus this request exceed the capture.');
}

/** Dispatch requires verified capture history, so a refund does not silently change kitchen work. */
export function productionTicketEligible(input: { canonicalCaptureVerified: boolean; fulfillment: FulfillmentState; preparationReleaseAt: Date; now: Date }): boolean {
  return input.canonicalCaptureVerified && ['ACCEPTED', 'IN_PREPARATION'].includes(input.fulfillment) && Number.isFinite(input.preparationReleaseAt.getTime()) && input.preparationReleaseAt <= input.now;
}

export function printOutcome(evidence: 'not-sent' | 'transport-delivered' | 'device-completed' | 'uncertain'): PrintState {
  switch (evidence) {
    case 'not-sent': return 'RETRY_WAIT';
    case 'transport-delivered': return 'DELIVERED';
    case 'device-completed': return 'CONFIRMED';
    case 'uncertain': return 'UNKNOWN';
  }
}

export function recoverExpiredPrintLease(state: PrintState, dispatchGateProvesNoSend: boolean, journalProvesNoSend: boolean): PrintState {
  if (state === 'LEASED') return dispatchGateProvesNoSend && journalProvesNoSend ? 'RETRY_WAIT' : 'UNKNOWN';
  if (state === 'SENDING') return 'UNKNOWN';
  return state;
}
