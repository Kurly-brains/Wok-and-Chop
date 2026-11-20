import { API_URL } from "./customer-session";

export type PickupStatus = "RECEIVED" | "PREPARING" | "READY_FOR_PICKUP" | "PICKED_UP" | "CANCELLED";

export const pickupStatusLabels: Record<PickupStatus, string> = {
  RECEIVED: "Request received",
  PREPARING: "In the kitchen",
  READY_FOR_PICKUP: "Ready for pickup",
  PICKED_UP: "Picked up",
  CANCELLED: "Cancelled",
};

export type PickupTotal = {
  items: { name: string; quantity: number; modifiers: string[]; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  taxCents: number | null;
};

export type PickupQuote = PickupTotal & { quoteFingerprint: string };
export type PickupOrder = PickupTotal & {
  id: string;
  number: string;
  status: PickupStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  statusHistory?: { status: PickupStatus; at: string }[];
};

export const pickupPromoKey = "wok-chop:pickup-promo";
export const pickupTrackingKey = "wok-chop:last-pickup";
export const pickupTrackingCode = /^[a-f0-9]{64}$/;

export function readPickupSession(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writePickupSession(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* The current checkout remains available when storage is blocked. */
  }
}

export class PickupRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function requestPickup<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/v1/auth/pickups${path}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new PickupRequestError(
      typeof data?.message === "string"
        ? data.message
        : "Direct pickup is temporarily unavailable.",
      response.ok ? 502 : response.status,
      typeof data?.code === "string" ? data.code : undefined,
    );
  }
  return data as T;
}
