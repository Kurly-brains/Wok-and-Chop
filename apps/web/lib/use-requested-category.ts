"use client";
import { useSyncExternalStore } from "react";
import { categories, lunchCategories } from "@wok/domain";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
function snapshot() {
  const value = new URLSearchParams(window.location.search).get("category");
  return [...categories, ...lunchCategories].some(
    (category) => category.id === value,
  )
    ? value!
    : "all";
}
export function useRequestedCategory() {
  return useSyncExternalStore(subscribe, snapshot, () => "all");
}
