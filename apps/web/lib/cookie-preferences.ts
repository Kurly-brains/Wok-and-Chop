"use client";

import { useSyncExternalStore } from "react";

type CookieChoice = "essential" | "external";
const preferenceKey = "wok-chop-cookie-preferences-v1";
const changeEvent = "wok-cookie-preferences-change";
let tabChoice: CookieChoice | null = null;

export function getCookiePreference() {
  if (tabChoice) return tabChoice;
  try {
    const value = window.localStorage.getItem(preferenceKey);
    return value === "essential" || value === "external" ? value : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    tabChoice = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, listener);
  };
}

export function useCookiePreference() {
  return useSyncExternalStore<CookieChoice | null | undefined>(
    subscribe,
    getCookiePreference,
    () => undefined,
  );
}

export function setCookiePreference(choice: CookieChoice) {
  tabChoice = choice;
  try {
    window.localStorage.setItem(preferenceKey, choice);
  } catch {
    // Keep the choice in this tab if storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}
