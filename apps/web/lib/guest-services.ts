import { API_URL } from "./customer-session";

export type GuestServiceConfig = {
  contactEnabled: boolean;
  reservationsEnabled: boolean;
  emailEnabled?: boolean;
  mode?: "LOCAL_PREVIEW";
  timeZone?: "America/Toronto";
  maxPartySize?: number;
  maxAdvanceDays?: number;
  minLeadMinutes?: number;
  timeStepMinutes?: number;
};

export type ReservationStatus = "REQUESTED" | "CONFIRMED" | "DECLINED" | "CANCELLED";
export type ReservationAction = "CONFIRM" | "RESCHEDULE" | "DECLINE" | "CANCEL";
export type GuestNotification = { emailQueued?: boolean; notificationMode?: "QUEUED" | "PREVIEW" };

export type ReservationReceipt = {
  number: string;
  date: string;
  time: string;
  partySize: number;
  status: ReservationStatus;
};

export type StaffReservation = ReservationReceipt & {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
};

export type StaffContact = {
  id: string;
  number: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  createdAt: string;
};

export const reservationStates: Record<ReservationStatus, string> = {
  REQUESTED: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

export class GuestServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function guestServiceRequest<T>(path: string, { body, signal }: {
  body?: object;
  signal?: AbortSignal;
} = {}): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(`${API_URL}/v1/${path}`, {
    cache: "no-store",
    credentials: "include",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    throw new GuestServiceError(
      typeof result?.message === "string" ? result.message : "The restaurant service is unavailable. Try again.",
      response.ok ? 502 : response.status,
    );
  }

  return result as T;
}

const torontoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const calendarDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const clockTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
});
export const torontoTimestamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  dateStyle: "medium",
  timeStyle: "short",
});

export function bookingDateRange(config: Pick<GuestServiceConfig, "maxAdvanceDays" | "minLeadMinutes">) {
  function isoDate(instant: number) {
    const parts = Object.fromEntries(torontoDate.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const now = Date.now();
  const earliest = isoDate(now + (config.minLeadMinutes ?? 60) * 60_000);
  const today = isoDate(now);
  const maximum = new Date(`${today}T00:00:00Z`);
  maximum.setUTCDate(maximum.getUTCDate() + (config.maxAdvanceDays ?? 180));
  return { earliest, latest: maximum.toISOString().slice(0, 10) };
}

export function formatReservationTime(date: string, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const clock = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return `${calendarDate.format(new Date(`${date}T00:00:00Z`))} · ${clockTime.format(clock)}`;
}
