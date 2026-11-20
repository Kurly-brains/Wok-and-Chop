export type TicketType = 'ORIGINAL' | 'HOLD' | 'REPRINT' | 'CANCELLATION';
export interface KitchenTicket {
  schemaVersion: 1;
  orderNumber: string;
  ticketType: TicketType;
  pickupLabel: string;
  station: string;
  training?: boolean;
  allergyNote?: string;
  kitchenNote?: string;
  copyNumber?: number;
  lines: { quantity: number; name: string; modifiers: string[]; note?: string; allergy?: boolean }[];
}

/** Plain text only; the printer adapter owns every command byte. */
export function sanitizeTicketText(value: string, maxCharacters = 240): string {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 10_000) throw new Error('Invalid ticket text limit.');
  const cleaned = value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length > maxCharacters ? chars.slice(0, Math.max(0, maxCharacters - 1)).join('') + '…' : cleaned;
}

export function wrapTicketText(value: string, columns = 42): string[] {
  if (!Number.isInteger(columns) || columns < 10 || columns > 80) throw new Error('Printer width must be between 10 and 80 columns.');
  const words = sanitizeTicketText(value, 10_000).split(' ');
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    if (Array.from(current + (current ? ' ' : '') + word).length <= columns) { current += (current ? ' ' : '') + word; continue; }
    if (current) { lines.push(current); current = ''; }
    let chars = Array.from(word);
    while (chars.length > columns) { lines.push(chars.slice(0, columns).join('')); chars = chars.slice(columns); }
    word = chars.join(''); current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Review/simulator text. Actual code pages, width and device completion need hardware qualification. */
export function renderKitchenTicket(ticket: KitchenTicket, columns = 42): string {
  if (ticket.schemaVersion !== 1 || !ticket.lines.length) throw new Error('A versioned ticket with items is required.');
  const heading: Record<TicketType, string> = {
    ORIGINAL: 'KITCHEN ORDER', HOLD: 'HOLD — DO NOT PREPARE',
    REPRINT: `REPRINT — COPY ${ticket.copyNumber ?? 0}`, CANCELLATION: 'CANCEL — DO NOT PREPARE',
  };
  if (ticket.ticketType === 'REPRINT' && (!Number.isInteger(ticket.copyNumber) || (ticket.copyNumber ?? 0) < 1)) throw new Error('A reprint requires a positive copy number.');
  const output = ['WOK & CHOP'];
  if (ticket.training) output.push('TRAINING — DO NOT PREPARE');
  output.push(heading[ticket.ticketType], `#${sanitizeTicketText(ticket.orderNumber, 30)}`, `Pickup: ${sanitizeTicketText(ticket.pickupLabel, 80)}`, `Station: ${sanitizeTicketText(ticket.station, 40)}`, '-'.repeat(columns));
  if (ticket.allergyNote) output.push('!! ORDER ALLERGY ALERT !!', ...wrapTicketText(ticket.allergyNote, columns), '');
  for (const line of ticket.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new Error('Invalid ticket quantity.');
    output.push(...wrapTicketText(`${line.quantity} × ${sanitizeTicketText(line.name, 120)}`, columns));
    line.modifiers.forEach((modifier) => output.push(...wrapTicketText(`  + ${sanitizeTicketText(modifier, 120)}`, columns)));
    if (line.allergy) output.push('!! ALLERGY NOTE — CHECK WITH STAFF !!');
    if (line.note) output.push(...wrapTicketText(`NOTE: ${sanitizeTicketText(line.note)}`, columns));
    output.push('');
  }
  if (ticket.kitchenNote) output.push('ORDER NOTE', ...wrapTicketText(ticket.kitchenNote, columns), '');
  return output.join('\n');
}

export interface PrinterAdapterResult {
  evidence: 'not-sent' | 'transport-delivered' | 'device-completed' | 'uncertain';
  detail: string;
}
export interface PrinterAdapter {
  /** Must be called only after fenced dispatch authorization and durable send intent. */
  send(jobId: string, immutablePayload: Uint8Array): Promise<PrinterAdapterResult>;
}

export type DeliverySlipAudience = 'kitchen' | 'driver';

export interface DeliverySlipOrder {
  number: string;
  status: 'RECEIVED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  fulfillment?: 'DELIVERY' | 'PICKUP';
  updatedAt: string;
  name: string;
  phone: string;
  address: { street: string; unit?: string | null; city: string; province: string; postalCode: string } | null;
  instructions?: string | null;
  items: { name: string; quantity: number; modifiers: readonly string[]; note?: string | null }[];
}

/** Text intended for manager-authorized local review and download. No printer commands. */
export function renderDeliverySlip(order: DeliverySlipOrder, audience: DeliverySlipAudience, columns = 42): string {
  const pickup = order.fulfillment === 'PICKUP';
  const state = { RECEIVED: 'Received', PREPARING: 'Preparing', READY_FOR_PICKUP: 'Ready for pickup', PICKED_UP: 'Picked up', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' }[order.status];
  const revised = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.updatedAt));
  const lines = ['WOK & CHOP', (pickup ? 'PICKUP' : 'DELIVERY') + (audience === 'kitchen' ? ' / KITCHEN COPY' : ' / DRIVER COPY'),
    '#' + sanitizeTicketText(order.number, 30), state, ...wrapTicketText('Updated ' + revised + ' (Toronto)', columns), '-'.repeat(columns)];
  if (order.status === 'CANCELLED') lines.push('CANCELLED / DO NOT FULFIL', '');
  if (order.status === 'DELIVERED') lines.push('ALREADY DELIVERED', '');
  if (order.status === 'PICKED_UP') lines.push('ALREADY PICKED UP', '');
  if (audience === 'kitchen') {
    for (const item of order.items) {
      lines.push(...wrapTicketText(item.quantity + ' × ' + item.name, columns));
      for (const modifier of item.modifiers) lines.push(...wrapTicketText('+ ' + modifier, columns));
      if (item.note) lines.push(...wrapTicketText('Kitchen note: ' + item.note, columns));
      lines.push('');
    }
  } else {
    if (pickup || !order.address) throw new Error('A delivery address is required for a driver slip.');
    const { street, unit, city, province, postalCode } = order.address;
    lines.push('RECIPIENT', ...wrapTicketText(order.name, columns), ...wrapTicketText(order.phone, columns), '',
      'DROP-OFF', ...wrapTicketText(street, columns));
    if (unit) lines.push(...wrapTicketText('Unit ' + unit, columns));
    lines.push(...wrapTicketText([city, province, postalCode].join(' '), columns));
    if (order.instructions) lines.push('', 'DELIVERY INSTRUCTIONS', ...wrapTicketText(order.instructions, columns));
  }
  return lines.join('\n').trimEnd();
}
