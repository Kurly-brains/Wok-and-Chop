import { lunchMenuItems } from './lunch-menu';
import { DomainError, normalizeNote, priceLine } from './pricing';
import type { CartSelection } from './types';

export type DemoFulfillment = "ACCEPTED" | "SCHEDULED" | "IN_PREPARATION" | "READY" | "COMPLETED";
export type DemoPayment = "TRAINING" | "PAID" | "PARTIALLY_REFUNDED";
export type DemoPrint = "SCREEN_ONLY" | "SPOOLED" | "QUEUED" | "DELIVERED" | "UNKNOWN";
export type DemoItem = { name: string; quantity: number; modifiers: string[]; note?: string };
export type DemoPrintJob = { id: string; kind: "ORIGINAL" | "REPRINT"; status: DemoPrint; copy: number; originalJobId?: string; reason?: string; actor?: string; at: string };
export type DemoOrder = {
  id: string;
  guest: string;
  payment: DemoPayment;
  fulfillment: DemoFulfillment;
  acceptedAt: string;
  dueAt: string;
  amountCents: number;
  items: DemoItem[];
  allergy?: string;
  note?: string;
  acknowledged: boolean;
  jobs: DemoPrintJob[];
  events: { id: string; text: string; at: string }[];
};
export type DemoService = { version: 1; revision?: number; paused: boolean; pauseReason: string; orders: DemoOrder[] };

export const DEMO_CLOCK = "2026-11-18T22:08:00.000Z";



export const fulfillmentLabels: Record<DemoFulfillment, string> = {
  ACCEPTED: "Awaiting preparation", SCHEDULED: "Scheduled · HOLD", IN_PREPARATION: "Preparing", READY: "Ready for pickup", COMPLETED: "Collected",
};
export const paymentLabels: Record<DemoPayment, string> = { TRAINING: "Training · no payment", PAID: "Simulated paid", PARTIALLY_REFUNDED: "Simulated partial refund" };
export const printLabels: Record<DemoPrint, string> = { SCREEN_ONLY: "Kitchen display only", SPOOLED: "Saved training slip", QUEUED: "Queued · not sent", DELIVERED: "Simulated transport delivery", UNKNOWN: "Unknown · check ticket" };

export function restaurantTime(instant: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(instant));
}

export function demoMoney(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

export function minutesWaiting(order: DemoOrder, clock: number) {
  return Math.max(0, Math.floor((clock - Date.parse(order.acceptedAt)) / 60_000));
}

function ticket(id: string, status: DemoPrint): DemoPrintJob[] {
  return [{ id: `demo-kot-${id}`, kind: "ORIGINAL", status, copy: 0, at: "2026-11-18T22:00:00.000Z" }];
}

export function seedDemoService(): DemoService {
  return { version: 1, paused: false, pauseReason: "", orders: [
    { id: "1048", guest: "Sample guest A", payment: "PAID", fulfillment: "ACCEPTED", acceptedAt: "2026-11-18T22:05:00Z", dueAt: "2026-11-18T22:25:00Z", amountCents: 4113, acknowledged: false, items: [{ name: "Chilli chicken", quantity: 1, modifiers: ["Medium spice", "Gravy"] }, { name: "Vegetable Hakka noodles", quantity: 2, modifiers: ["Mild spice"] }], allergy: "Peanut allergy — confirm with the guest before preparation.", note: "Please pack the sauce separately.", jobs: ticket("1048", "DELIVERED"), events: [{ id: "1048-created", text: "Sample paid order accepted", at: "2026-11-18T22:05:00Z" }] },
    { id: "1049", guest: "Sample guest B", payment: "PAID", fulfillment: "ACCEPTED", acceptedAt: "2026-11-18T22:07:00Z", dueAt: "2026-11-18T22:30:00Z", amountCents: 2995, acknowledged: false, items: [{ name: "Szechuan fried rice", quantity: 1, modifiers: ["Hot spice", "Chicken"] }, { name: "Vegetable spring rolls", quantity: 1, modifiers: [] }], note: "Ticket outcome is uncertain. Check for an existing paper ticket before making another copy.", jobs: ticket("1049", "UNKNOWN"), events: [{ id: "1049-unknown", text: "Sample transport acknowledgment lost; automatic resend held", at: "2026-11-18T22:07:00Z" }] },
    { id: "1047", guest: "Sample guest C", payment: "PAID", fulfillment: "IN_PREPARATION", acceptedAt: "2026-11-18T21:56:00Z", dueAt: "2026-11-18T22:15:00Z", amountCents: 4520, acknowledged: true, items: [{ name: "Manchurian chicken", quantity: 2, modifiers: ["Medium spice"] }, { name: "Steamed rice", quantity: 1, modifiers: [] }], jobs: ticket("1047", "DELIVERED"), events: [{ id: "1047-preparing", text: "Sample kitchen acknowledgment; preparation started", at: "2026-11-18T22:00:00Z" }] },
    { id: "1046", guest: "Sample guest D", payment: "PARTIALLY_REFUNDED", fulfillment: "READY", acceptedAt: "2026-11-18T21:45:00Z", dueAt: "2026-11-18T22:05:00Z", amountCents: 3108, acknowledged: true, items: [{ name: "Vegetable Hakka noodles", quantity: 1, modifiers: ["Mild spice"] }, { name: "Chilli paneer", quantity: 1, modifiers: ["Medium spice"] }], jobs: ticket("1046", "DELIVERED"), events: [{ id: "1046-ready", text: "Sample order ready; financial adjustment is separate from fulfillment", at: "2026-11-18T22:04:00Z" }] },
    { id: "1050", guest: "Sample guest E", payment: "PAID", fulfillment: "SCHEDULED", acceptedAt: "2026-11-18T21:30:00Z", dueAt: "2026-11-18T23:15:00Z", amountCents: 5695, acknowledged: false, items: [{ name: "Chilli chicken", quantity: 2, modifiers: ["Hot spice", "Dry"] }, { name: "Chicken Hakka noodles", quantity: 1, modifiers: ["Medium spice"] }], jobs: ticket("1050", "QUEUED"), events: [{ id: "1050-hold", text: "Sample scheduled order — HOLD, do not prepare", at: "2026-11-18T21:30:00Z" }] },
    { id: "1045", guest: "Sample guest F", payment: "PAID", fulfillment: "COMPLETED", acceptedAt: "2026-11-18T21:25:00Z", dueAt: "2026-11-18T21:45:00Z", amountCents: 2260, acknowledged: true, items: [{ name: "Chicken Hakka noodles", quantity: 1, modifiers: ["Medium spice"] }], jobs: ticket("1045", "DELIVERED"), events: [{ id: "1045-collected", text: "Sample order collected", at: "2026-11-18T21:47:00Z" }] },
  ] };
}

export function parseService(raw: string | null): DemoService {
  try {
    if (!raw) return seedDemoService();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1 || !("orders" in parsed) || !Array.isArray(parsed.orders)) return seedDemoService();
    const candidate = parsed as DemoService;
    if (typeof candidate.paused !== "boolean" || typeof candidate.pauseReason !== "string" || candidate.orders.some(order => !order || !order.id || !fulfillmentLabels[order.fulfillment] || !paymentLabels[order.payment] || typeof order.guest !== "string" || !Number.isSafeInteger(order.amountCents) || !Number.isFinite(Date.parse(order.dueAt)) || !Number.isFinite(Date.parse(order.acceptedAt)) || !Array.isArray(order.jobs) || !order.jobs.length || order.jobs.some(job => !job || !printLabels[job.status] || typeof job.id !== "string") || !Array.isArray(order.items) || order.items.some(item => !item || typeof item.name !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || (item.note !== undefined && typeof item.note !== "string") || !Array.isArray(item.modifiers) || item.modifiers.some(modifier => typeof modifier !== "string")) || !Array.isArray(order.events) || order.events.some(event => !event || typeof event.text !== "string" || !Number.isFinite(Date.parse(event.at))))) return seedDemoService();
    return candidate;
  } catch { return seedDemoService(); }
}


export type TicketAction = "acknowledge" | "start" | "ready" | "collect" | "reprint";
export type TrainingCommand =
  | { type: "create"; lines: CartSelection[]; minutes: number; allergy: string; note: string }
  | { type: TicketAction; orderId: string; reason?: string; priorCopies?: number }
  | { type: "pause"; reason: string }
  | { type: "resume" };

export function seedTrainingAt(now: number): DemoService {
  const service = seedDemoService();
  const offset = now - Date.parse(DEMO_CLOCK);
  const shift = (stamp: string) => new Date(Date.parse(stamp) + offset).toISOString();
  service.revision = 0;
  for (const order of service.orders) {
    order.acceptedAt = shift(order.acceptedAt);
    order.dueAt = shift(order.dueAt);
    for (const job of order.jobs) job.at = shift(job.at);
    for (const event of order.events) event.at = shift(event.at);
  }
  return service;
}

export function nextTicketAction(order: DemoOrder): { type: TicketAction; label: string } | undefined {
  switch (order.fulfillment) {
    case "ACCEPTED": return order.acknowledged
      ? { type: "start", label: "Start preparation" }
      : { type: "acknowledge", label: "Accept ticket" };
    case "IN_PREPARATION": return { type: "ready", label: "Mark ready for pickup" };
    case "READY": return { type: "collect", label: "Mark collected" };
  }
}

function invalid(message: string): never { throw new DomainError("INVALID_TICKET", message); }
function conflict(message: string): never { throw new DomainError("TICKET_CONFLICT", message); }
function textField(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) invalid("Ticket text is too long or missing.");
  return normalizeNote(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Only synthetic training tickets enter this reducer. Commands contain no payment or device destinations. */
export function applyTrainingCommand(previous: DemoService, input: unknown, commandId: string, stamp: string): DemoService {
  if (!record(input)) invalid("Choose a valid ticket action.");
  const revision = (previous.revision ?? 0) + 1;
  if (input.type === "pause" || input.type === "resume") {
    const paused = input.type === "pause";
    if (previous.paused === paused) conflict("Service state changed. Refresh the board.");
    const reason = paused ? textField(input.reason, 160) : "";
    if (paused && reason.length < 5) invalid("Enter a pause reason of at least five characters.");
    return { ...previous, revision, paused, pauseReason: reason };
  }
  const log = (text: string) => ({ id: commandId, at: stamp, text });
  if (input.type === "create") {
    if (previous.paused) conflict("Resume training service before entering a ticket.");
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 20) invalid("Enter between one and twenty dishes.");
    if (typeof input.minutes !== "number" || !Number.isInteger(input.minutes) || input.minutes < 5 || input.minutes > 120) invalid("Choose a pickup time between 5 and 120 minutes.");
    const lines = input.lines.map((line: unknown) => {
      if (!record(line) || typeof line.itemId !== "string" || typeof line.quantity !== "number" || !Array.isArray(line.modifierIds) || line.modifierIds.length > 20 || line.modifierIds.some((id: unknown) => typeof id !== "string")) invalid("Choose a valid menu item and its options.");
      return priceLine({ itemId: line.itemId, quantity: line.quantity, modifierIds: line.modifierIds, note: textField(line.note ?? "", 240) }, lunchMenuItems);
    });
    const nextNumber = previous.orders.reduce((max, order) => Math.max(max, Number(order.id)), 1050) + 1;
    const id = String(nextNumber);
    const order: DemoOrder = {
      id, guest: "Training pickup " + id, payment: "TRAINING", fulfillment: "ACCEPTED",
      acknowledged: false, acceptedAt: stamp, dueAt: new Date(Date.parse(stamp) + input.minutes * 60_000).toISOString(),
      items: lines.map(line => ({ name: line.name, quantity: line.quantity, modifiers: line.modifiers.map(option => option.name), note: line.note })),
      amountCents: lines.reduce((total, line) => total + line.lineTotalCents, 0), allergy: textField(input.allergy, 240), note: textField(input.note, 240),
      jobs: [{ id: "training-" + commandId, kind: "ORIGINAL", status: "SCREEN_ONLY", copy: 0, at: stamp }],
      events: [log("Staff entered a training pickup ticket")],
    };
    return { ...previous, revision, orders: [order, ...previous.orders] };
  }
  if (typeof input.orderId !== "string") invalid("Choose an order.");
  const order = previous.orders.find(entry => entry.id === input.orderId);
  if (!order) conflict("This ticket is no longer on the board.");
  let updated: DemoOrder;
  if (input.type === "reprint") {
    const reason = textField(input.reason, 240);
    if (reason.length < 5) invalid("Give a reason of at least five characters.");
    if (["SCHEDULED", "COMPLETED"].includes(order.fulfillment) || order.jobs.some(job => job.kind === "REPRINT" && job.status === "QUEUED")) conflict("This ticket cannot receive another copy request.");
    const existingCopies = order.jobs.filter(job => job.kind === "REPRINT").length;
    if ((input.priorCopies ?? 0) !== existingCopies) conflict("A copy was already requested. Review its number before requesting another.");
    const copy = 1 + existingCopies;
    const job: DemoPrintJob = { id: "training-reprint-" + commandId, kind: "REPRINT", status: "QUEUED", copy, originalJobId: order.jobs[0].id, reason, actor: "Training staff", at: stamp };
    updated = { ...order, jobs: [...order.jobs, job], events: [...order.events, log("Replacement ticket requested in training: " + reason)] };
  } else {
    const action = nextTicketAction(order);
    if (!action || action.type !== input.type) conflict("This ticket changed. Review its current stage.");
    const next = { acknowledge: "ACCEPTED", start: "IN_PREPARATION", ready: "READY", collect: "COMPLETED", reprint: order.fulfillment } as const;
    const message = { acknowledge: "Kitchen accepted the ticket", start: "Preparation started", ready: "Marked ready for pickup", collect: "Pickup collected", reprint: "" };
    updated = { ...order, fulfillment: next[action.type], acknowledged: true, events: [...order.events, log(message[action.type])] };
  }
  return { ...previous, revision, orders: previous.orders.map(entry => entry.id === order.id ? updated : entry) };
}
