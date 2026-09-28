"use client";

import { MoonIcon, SunIcon } from "./icons";
import { setColorScheme, useColorScheme } from "./useColorScheme";

// Switches between light and dark. The choice is saved for the next visit.
export default function ThemeToggle() {
  const scheme = useColorScheme();
  const next = scheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setColorScheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface hover:bg-hover"
    >
      {scheme === "dark" ? <SunIcon className="h-3.5 w-3.5" /> : <MoonIcon className="h-3.5 w-3.5" />}
    </button>
  );
}
