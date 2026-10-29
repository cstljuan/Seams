"use client";

import { useSyncExternalStore } from "react";

// Phones get the bottom-sheet layout; 768 px and up keep the desktop sidebar.
const QUERY = "(max-width: 767px)";

function subscribe(fn: () => void) {
  const m = matchMedia(QUERY);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => false);
}
