"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, refreshCustomer } from "./customer-session";

export type DeliveryStatus = "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
export type ManagerDelivery = {
  id: string;
  number: string;
  status: DeliveryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  name: string;
  phone: string;
  address: { street: string; unit: string; city: string; province: string; postalCode: string };
  instructions: string;
  items: { name: string; quantity: number; modifiers: string[]; note: string; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  deliveryCents: number | null;
  taxCents: number | null;
  totalCents: number;
};
type Scope = "active" | "history";
type Result = { deliveries: ManagerDelivery[]; nextCursor: string | null };
type Access = "loading" | "ready" | "signed-out" | "forbidden" | "error";
const endpoint = API_URL + "/v1/auth/admin/deliveries";
export const statusNames: Record<DeliveryStatus, string> = {
  RECEIVED: "Received", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
export const nextAction: Partial<Record<DeliveryStatus, { status: DeliveryStatus; title: string }>> = {
  RECEIVED: { status: "PREPARING", title: "Start preparation" },
  PREPARING: { status: "OUT_FOR_DELIVERY", title: "Mark out for delivery" },
  OUT_FOR_DELIVERY: { status: "DELIVERED", title: "Mark delivered" },
};
export const restaurantClock = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });
export const restaurantDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" });

export function useManagerDeliveries(scope: Scope, cursor = "") {
  const [orders, setOrders] = useState<ManagerDelivery[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState<Date | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const command = useRef<AbortController | null>(null);

  const restrict = useCallback((httpStatus: number) => {
    setOrders([]);
    setNextCursor(null);
    setAccess(httpStatus === 401 ? "signed-out" : "forbidden");
    if (httpStatus === 401) void refreshCustomer();
  }, []);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const found = new Map<string, ManagerDelivery>();
    try {
      let after = cursor;
      let next: string | null;
      const seen = new Set<string>();
      do {
        if (seen.has(after)) throw new Error("Could not finish loading delivery tickets.");
        seen.add(after);
        const params = new URLSearchParams({ scope });
        if (after) params.set("after", after);
        const response = await fetch(endpoint + "?" + params, { credentials: "include", cache: "no-store", signal });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { restrict(response.status); return; }
        if (!response.ok) throw new Error();
        const result: Result = await response.json();
        for (const order of result.deliveries) found.set(order.id, order);
        next = result.nextCursor;
        after = next ?? "";
      } while (scope === "active" && next);
      if (controller.signal.aborted) return;
      setOrders([...found.values()]);
      setNextCursor(scope === "history" ? next : null);
      setChecked(new Date());
      setAccess("ready");
    } catch {
      if (!controller.signal.aborted) {
        setAccess("error");
        setOrders([]);
        setNextCursor(null);
      }
    } finally { if (inflight.current === controller) inflight.current = null; }
  }, [scope, cursor, restrict]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = () => { if (!document.hidden && !inflight.current && !command.current) void refresh(); };
    const timer = window.setInterval(poll, scope === "active" ? 5000 : 30000);
    window.addEventListener("focus", poll);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", poll); inflight.current?.abort(); command.current?.abort(); };
  }, [refresh, scope]);

  async function transition(order: ManagerDelivery, status: DeliveryStatus) {
    if (command.current) return;
    const controller = new AbortController();
    command.current = controller;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(endpoint + "/" + encodeURIComponent(order.id) + "/status", {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: order.version, status }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { inflight.current?.abort(); restrict(response.status); return; }
      if (response.status === 409) { setMessage("Another team member updated this ticket. Review its latest status."); }
      else if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(typeof result.message === "string" ? result.message : "Could not update this delivery.");
      } else { setMessage(order.number + " marked " + statusNames[status].toLowerCase() + "."); }
    } catch {
      if (!controller.signal.aborted) setMessage("The update could not be confirmed. Check the ticket’s current status before retrying.");
    } finally {
      if (!controller.signal.aborted) await refresh();
      command.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return { access, orders, checked, nextCursor, refresh, transition, message, saving };
}
export type ManagerQueue = ReturnType<typeof useManagerDeliveries>;
