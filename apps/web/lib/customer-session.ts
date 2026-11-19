"use client";
import { useEffect, useSyncExternalStore } from "react";
export type Customer = { id: string; name: string; email: string };
export const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000";
let customer: Customer | null = null;
let requestSequence = 0;
let mutationPending = false;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
function readCustomer(value: unknown): Customer | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The account service returned an invalid response.");
  }
  const user = value as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    !user.id ||
    typeof user.name !== "string" ||
    !user.name.trim() ||
    user.name.length > 80 ||
    typeof user.email !== "string" ||
    user.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
  )
    throw new Error("The account service returned an invalid response.");
  return { id: user.id, name: user.name, email: user.email };
}
function publish(next: Customer | null) {
  customer = next;
  listeners.forEach((callback) => callback());
}
export async function refreshCustomer() {
  // A background read must not overwrite an in-flight sign-in or logout.
  if (mutationPending) return customer;
  const sequence = ++requestSequence;
  try {
    const response = await fetch(`${API_URL}/v1/auth/me`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return customer;
    const next = readCustomer((await response.json()).user);
    if (sequence === requestSequence && !mutationPending) publish(next);
  } catch {
    // Transport/service errors are not evidence that a valid session ended.
  }
  return customer;
}
export function useCustomer() {
  const user = useSyncExternalStore(
    subscribe,
    () => customer,
    () => null,
  );
  useEffect(() => {
    void refreshCustomer();
    const refresh = () => {
      void refreshCustomer();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return user;
}
export async function authRequest(
  path: "register" | "login" | "logout",
  body?: Record<string, string>,
) {
  if (mutationPending)
    throw new Error(
      "An account request is already in progress. Please wait a moment.",
    );
  mutationPending = true;
  ++requestSequence;
  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/v1/auth/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      throw new Error(
        "The account service is not available. Please try again, or continue as a guest.",
      );
    }
    const raw: unknown = await response.json().catch(() => ({}));
    const result =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    if (!response.ok)
      throw new Error(
        typeof result.message === "string"
          ? result.message
          : "Unable to complete that request. Please check your details and try again.",
      );
    if (path === "logout") {
      if (result.ok !== true)
        throw new Error(
          "The account service could not confirm sign-out. Please try again.",
        );
      ++requestSequence;
      publish(null);
    } else {
      const next = readCustomer(result.user);
      if (!next)
        throw new Error(
          "The account service could not confirm sign-in. Please try again.",
        );
      ++requestSequence;
      publish(next);
    }
  } finally {
    mutationPending = false;
  }
}
