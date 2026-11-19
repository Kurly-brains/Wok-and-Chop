export interface QuoteRequest {
  lines: { itemId: string; quantity: number; modifierIds: string[]; note: string }[];
  fulfillment: { type: 'PICKUP'; timing: 'ASAP' | 'SCHEDULED'; pickupAt?: string };
}

export class ContractError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(message: string) { super(message); this.name = 'ContractError'; }
}

function object(value: unknown, allowedKeys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContractError(`${label} must be an object.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowedKeys.includes(key))) throw new ContractError(`${label} contains unsupported fields.`);
  return result;
}

/** Strict input boundary: client amounts, statuses, payment flags and arbitrary fields are rejected. */
export function parseCartLines(value: unknown): QuoteRequest['lines'] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw new ContractError('Choose between 1 and 40 cart lines.');
  return value.map((raw) => {
    const line = object(raw, ['itemId', 'quantity', 'modifierIds', 'note'], 'Cart line');
    if (typeof line.itemId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(line.itemId)) throw new ContractError('Invalid dish identifier.');
    if (typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new ContractError('Quantity must be between 1 and 20.');
    const modifierIds = line.modifierIds ?? [];
    if (!Array.isArray(modifierIds) || modifierIds.length > 20 || modifierIds.some((id) => typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id)) || new Set(modifierIds).size !== modifierIds.length) throw new ContractError('Invalid modifier selection.');
    const note = line.note ?? '';
    if (typeof note !== 'string' || note.length > 240) throw new ContractError('Notes must be 240 characters or fewer.');
    return { itemId: line.itemId, quantity: line.quantity, modifierIds: modifierIds as string[], note };
  });
}
export function parseQuoteRequest(value: unknown): QuoteRequest {
  const request = object(value, ['lines', 'fulfillment'], 'Request');
  const lines = parseCartLines(request.lines);
  const fulfillment = object(request.fulfillment, ['type', 'timing', 'pickupAt'], 'Fulfillment');
  if (fulfillment.type !== 'PICKUP') throw new ContractError('Only pickup is available.');
  if (fulfillment.timing !== 'ASAP' && fulfillment.timing !== 'SCHEDULED') throw new ContractError('Choose ASAP or scheduled pickup.');
  if (fulfillment.timing === 'SCHEDULED') {
    if (typeof fulfillment.pickupAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fulfillment.pickupAt) || !Number.isFinite(Date.parse(fulfillment.pickupAt))) throw new ContractError('Scheduled pickup requires an unambiguous UTC instant.');
    const canonical = new Date(fulfillment.pickupAt).toISOString();
    if (canonical !== fulfillment.pickupAt && canonical.replace('.000Z', 'Z') !== fulfillment.pickupAt) throw new ContractError('The scheduled pickup date is invalid.');
  }
  if (fulfillment.timing === 'ASAP' && fulfillment.pickupAt !== undefined) throw new ContractError('ASAP pickup does not accept a promised pickup time.');
  return { lines, fulfillment: { type: 'PICKUP', timing: fulfillment.timing, ...(typeof fulfillment.pickupAt === 'string' ? { pickupAt: fulfillment.pickupAt } : {}) } };
}

/** Versioned envelopes are transport contracts, not an in-memory substitute for the durable outbox. */
export interface DomainEvent<T> {
  schemaVersion: 1;
  id: string;
  aggregateId: string;
  occurredAt: string;
  type: 'order.accepted' | 'order.preparation-due' | 'order.ready' | 'payment.received' | 'print.attention-required';
  payload: T;
}

export interface ApiError { code: string; message: string; correlationId: string; details?: Record<string, string> }
