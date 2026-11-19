import { DomainError } from './pricing';

export const RESTAURANT_TIME_ZONE = 'America/Toronto';
const minuteFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function partsAt(date: Date) {
  const parts = Object.fromEntries(minuteFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`, utcShape: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) };
}

/** Reject nonexistent local times; daylight-saving folds require an explicit choice. */
export function resolveTorontoLocalTime(localTime: string, disambiguation?: 'earlier' | 'later'): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) throw new DomainError('INVALID_LOCAL_TIME', 'Use a restaurant-local date and time.');
  const utcShape = Date.parse(`${localTime}:00Z`);
  if (!Number.isFinite(utcShape) || new Date(utcShape).toISOString().slice(0, 16) !== localTime) throw new DomainError('INVALID_LOCAL_TIME', 'The pickup date or time is invalid.');
  const offsets = new Set<number>();
  for (const shift of [-36, 0, 36]) {
    const sample = new Date(utcShape + shift * 3_600_000);
    offsets.add(partsAt(sample).utcShape - sample.getTime());
  }
  const matches = [...offsets].map((offset) => new Date(utcShape - offset)).filter((date) => partsAt(date).local === localTime).sort((a, b) => a.getTime() - b.getTime());
  if (!matches.length) throw new DomainError('NONEXISTENT_LOCAL_TIME', 'This pickup time does not exist because the clocks change.');
  if (matches.length > 1 && !disambiguation) throw new DomainError('AMBIGUOUS_LOCAL_TIME', 'This pickup time occurs twice. Select the earlier or later time explicitly.');
  return disambiguation === 'later' ? matches[matches.length - 1] : matches[0];
}

export function formatRestaurantTime(date: Date | string, includeDate = true): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: RESTAURANT_TIME_ZONE, ...(includeDate ? { weekday: 'short', month: 'short', day: 'numeric' } as const : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(date));
}

export function isSlotBookable(input: { now: Date; pickupAt: Date; prepMinutes: number; remainingCapacity: number; requiredCapacity?: number; checkoutMinutes?: number; safetyMinutes?: number }): boolean {
  const checkout = input.checkoutMinutes ?? 30;
  const safety = input.safetyMinutes ?? 0;
  const required = input.requiredCapacity ?? 1;
  if (![input.now.getTime(), input.pickupAt.getTime(), input.prepMinutes, input.remainingCapacity, required, checkout, safety].every(Number.isFinite) || input.prepMinutes < 0 || checkout < 30 || safety < 0 || required <= 0) return false;
  return input.remainingCapacity >= required && input.pickupAt.getTime() >= input.now.getTime() + (input.prepMinutes + checkout + safety) * 60_000;
}

export function calculateAsapReadyAt(verifiedAcceptanceAt: Date, prepMinutes: number): Date {
  if (!Number.isFinite(verifiedAcceptanceAt.getTime()) || !Number.isFinite(prepMinutes) || prepMinutes < 0) throw new DomainError('INVALID_PREPARATION_TIME', 'A verified acceptance time and preparation duration are required.');
  return new Date(verifiedAcceptanceAt.getTime() + prepMinutes * 60_000);
}
