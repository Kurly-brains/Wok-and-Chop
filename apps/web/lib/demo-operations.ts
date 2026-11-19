"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyTrainingCommand, parseService, seedDemoService, type DemoService, type TrainingCommand,
} from "@wok/domain/training";
import { API_URL } from "./customer-session";

export { demoMoney, fulfillmentLabels, minutesWaiting, nextTicketAction, paymentLabels, printLabels, restaurantTime } from "@wok/domain/training";
export type { DemoOrder, DemoFulfillment, TicketAction } from "@wok/domain/training";

const KEY = "wok-chop:operations-preview:v1";
const CHANGE_EVENT = "wok-chop:operations-changed";
const endpoint = API_URL + "/v1/training/operations";
const initial = seedDemoService();
type Connection = "checking" | "shared" | "offline" | "local";
let localCache = initial;
let rawCache: string | null | undefined;
let memoryOnly = false;

function localSnapshot(): DemoService {
  if (memoryOnly || typeof window === "undefined") return localCache;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== rawCache) { rawCache = raw; localCache = parseService(raw); }
  } catch { memoryOnly = true; }
  return localCache;
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(CHANGE_EVENT, listener); };
}

function writeLocal(command: TrainingCommand, id: string): DemoService {
  const next = applyTrainingCommand(localSnapshot(), command, id, new Date().toISOString());
  localCache = next;
  try { const raw = JSON.stringify(next); window.localStorage.setItem(KEY, raw); rawCache = raw; }
  catch { memoryOnly = true; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
}

export function useDemoService() {
  const local = useSyncExternalStore(subscribe, localSnapshot, () => initial);
  const [shared, setShared] = useState<DemoService | null>(null);
  const [connection, setConnection] = useState<Connection>("checking");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const writing = useRef(false);
  const hasShared = useRef(false);
  const pending = useRef<{ id: string; command: TrainingCommand } | null>(null);

  const acceptShared = useCallback((value: DemoService) => {
    hasShared.current = true;
    setShared(current => current && (current.revision ?? 0) > (value.revision ?? 0) ? current : value);
    setConnection("shared");
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const snapshot: DemoService = await response.json();
      if (snapshot.version !== 1 || !Array.isArray(snapshot.orders)) throw new Error();
      if (!signal?.aborted) acceptShared(snapshot);
    } catch {
      if (!signal?.aborted) setConnection(hasShared.current ? "offline" : "local");
    }
  }, [acceptShared]);

  useEffect(() => {
    if (connection === "local") return;
    const controller = new AbortController();
    const load = () => { void refresh(controller.signal); };
    load();
    const interval = window.setInterval(load, 2500);
    window.addEventListener("focus", load);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", load); };
  }, [connection, refresh]);

  const reconnect = () => { setConnection("checking"); };

  async function run(command: TrainingCommand, message: string) {
    if (writing.current || connection === "checking" || connection === "offline") return false;
    writing.current = true;
    setBusy(true);
    const prior = pending.current;
    const same = prior && JSON.stringify(prior.command) === JSON.stringify(command);
    const request = same ? prior : { id: crypto.randomUUID(), command };
    try {
      if (connection === "local") {
        const write = () => writeLocal(command, request.id);
        if (navigator.locks) await navigator.locks.request(KEY, write);
        else write();
      } else {
        if (prior && !same) { setNotice("Retry the previous action to confirm its outcome first."); return false; }
        pending.current = request;
        const response = await fetch(endpoint + "/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
        if (!response.ok) {
          if (response.status < 500) pending.current = null;
          const detail = await response.json().catch(() => ({}));
          if (response.status === 409) await refresh();
          throw new Error(typeof detail.message === "string" ? detail.message : "The board could not complete that action.");
        }
        const snapshot: DemoService = await response.json();
        pending.current = null;
        setUncertain(false);
        acceptShared(snapshot);
      }
      setNotice(message);
      return true;
    } catch (error) {
      setUncertain(Boolean(pending.current));
      setNotice(pending.current ? "The server did not confirm the action. Retry it with the same request." : error instanceof Error ? error.message : "The ticket could not be updated.");
      return false;
    } finally { writing.current = false; setBusy(false); }
  }

  return {
    service: shared ?? local, connection, notice, busy: busy || connection === "checking" || connection === "offline",
    run, reconnect, memoryOnly,
    uncertain,
    retry: () => pending.current && run(pending.current.command, "Action confirmed."),
  };
}

export type TrainingWorkspace = ReturnType<typeof useDemoService>;
