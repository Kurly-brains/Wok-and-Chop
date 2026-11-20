"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, refreshCustomer } from "./customer-session";
import type { DeliveryStatus, DeliveryStatusEvent } from "./delivery";

export type ManagerOrderStatus = DeliveryStatus | "READY_FOR_PICKUP" | "PICKED_UP";
export type ManagerAuditEvent = {
  action: "STATUS" | "UNDO" | "NOTE" | "ARCHIVE" | "RESTORE";
  at: string;
  status: ManagerOrderStatus;
  version: number;
  reason?: string | null;
};
export type ManagerDelivery = {
  id: string;
  number: string;
  status: ManagerOrderStatus;
  fulfillment?: "DELIVERY" | "PICKUP";
  version: number;
  createdAt: string;
  updatedAt: string;
  managerNote?: string;
  archived?: boolean;
  archivedAt?: string | null;
  createdByManager?: boolean;
  canUndoStatus?: boolean;
  undoTargetStatus?: ManagerOrderStatus | null;
  auditHistory?: ManagerAuditEvent[];
  statusHistory?: (Omit<DeliveryStatusEvent, "status"> & { status: ManagerOrderStatus })[];
  name: string;
  phone: string;
  address: { street: string; unit: string; city: string; province: string; postalCode: string } | null;
  instructions: string;
  items: { name: string; quantity: number; modifiers: string[]; note: string; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  deliveryCents: number | null;
  taxCents: number | null;
  totalCents: number;
};
export type ManagerQueueScope = "active" | "history" | "archived";
type Result = { deliveries: ManagerDelivery[]; nextCursor: string | null };
type Access = "loading" | "ready" | "signed-out" | "forbidden" | "error";
const endpoint = API_URL + "/v1/auth/admin/deliveries";
export const statusNames: Record<ManagerOrderStatus, string> = {
  RECEIVED: "Received", PREPARING: "Preparing", READY_FOR_PICKUP: "Ready for pickup", PICKED_UP: "Picked up",
  OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
type OrderAction = { status: ManagerOrderStatus; title: string };
const deliveryActions: Partial<Record<ManagerOrderStatus, OrderAction>> = {
  RECEIVED: { status: "PREPARING", title: "Start preparation" },
  PREPARING: { status: "OUT_FOR_DELIVERY", title: "Mark out for delivery" },
  OUT_FOR_DELIVERY: { status: "DELIVERED", title: "Mark delivered" },
};
const pickupActions: Partial<Record<ManagerOrderStatus, OrderAction>> = {
  RECEIVED: deliveryActions.RECEIVED,
  PREPARING: { status: "READY_FOR_PICKUP", title: "Mark ready for pickup" },
  READY_FOR_PICKUP: { status: "PICKED_UP", title: "Mark picked up" },
};
export function nextOrderAction(order: ManagerDelivery) {
  return (order.fulfillment === "PICKUP" ? pickupActions : deliveryActions)[order.status];
}
export const restaurantClock = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });
export const restaurantDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" });

type PickupManagementAction =
  | { type: "undo"; reason: string }
  | { type: "archive"; archived: boolean }
  | { type: "note"; note: string };

export function useManagerDeliveries(scope: ManagerQueueScope, cursor = "") {
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
        if (seen.has(after)) throw new Error("Could not finish loading order tickets.");
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
      setNextCursor(scope === "active" ? null : next);
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

  async function updateOrder(
    order: ManagerDelivery,
    action: string,
    changes: Record<string, string | boolean>,
    success: string,
  ) {
    if (command.current) return false;
    const controller = new AbortController();
    command.current = controller;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(endpoint + "/" + encodeURIComponent(order.id) + "/" + action, {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: order.version, ...changes }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (controller.signal.aborted) return false;
      if (response.status === 401 || response.status === 403) { inflight.current?.abort(); restrict(response.status); return false; }
      if (response.status === 409) { setMessage("This ticket changed or the action is no longer available. Review its latest details."); }
      else if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(typeof result.message === "string" ? result.message : "Could not update this order.");
      } else {
        setMessage(success);
        return true;
      }
    } catch {
      if (!controller.signal.aborted) setMessage("The update could not be confirmed. Check the ticket’s current status before retrying.");
    } finally {
      if (!controller.signal.aborted) await refresh();
      command.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
    return false;
  }

  function transition(order: ManagerDelivery, status: ManagerOrderStatus) {
    return updateOrder(order, "status", { status }, `${order.number} marked ${statusNames[status].toLowerCase()}.`);
  }

  function managePickup(order: ManagerDelivery, action: PickupManagementAction) {
    switch (action.type) {
      case "undo":
        return updateOrder(order, "undo", { reason: action.reason }, `${order.number}'s status was restored.`);
      case "archive":
        return updateOrder(order, "archive", { archived: action.archived }, `${order.number} ${action.archived ? "moved to the archive" : "restored to order history"}.`);
      case "note":
        return updateOrder(order, "note", { note: action.note }, `${order.number}'s manager note was ${action.note ? "saved" : "removed"}.`);
    }
  }

  return { access, orders, checked, nextCursor, refresh, transition, managePickup, message, saving };
}
export type ManagerQueue = ReturnType<typeof useManagerDeliveries>;
