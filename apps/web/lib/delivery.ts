import { API_URL } from "./customer-session";

export const deliveryStages = [
  { id: "RECEIVED", label: "Received" },
  { id: "PREPARING", label: "In the kitchen" },
  { id: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { id: "DELIVERED", label: "Delivered" },
] as const;

export type DeliveryStatus = (typeof deliveryStages)[number]["id"] | "CANCELLED";
export type DeliveryStatusEvent = { status: DeliveryStatus; at: string };
export const deliveryEventTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export type Delivery = {
  id: string;
  number: string;
  status: DeliveryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  statusHistory?: DeliveryStatusEvent[];
  items: {
    name: string;
    quantity: number;
    modifiers: string[];
    lineTotalCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

export const guestReceiptKey = "wok-chop:guest-delivery";

export function readDeliverySession(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveDeliverySession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* The form also works without browser storage. */
  }
}

export class DeliveryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestDelivery<T>(
  route: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}/v1/auth/deliveries${route}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = data?.message;
    throw new DeliveryRequestError(
      typeof message === "string"
        ? message
        : "The delivery service is temporarily unavailable.",
      response.ok ? 502 : response.status,
    );
  }
  return data as T;
}
