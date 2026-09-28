"use client";

import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

// The chosen theme lives on <html data-theme>. The script in app/layout.tsx sets it
// before paint from the saved choice, or from the device setting if there is none.
export const THEME_KEY = "seams-theme";

function read(): ColorScheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, read, () => "light");
}

// Pick a theme and remember it. After this the device setting no longer switches it.
export function setColorScheme(scheme: ColorScheme) {
  document.documentElement.dataset.theme = scheme;
  try {
    localStorage.setItem(THEME_KEY, scheme);
  } catch {
    // Storage can be blocked; the choice still holds for this visit.
  }
}
