"use client";

import { useEffect, useSyncExternalStore } from "react";

// Any colour, picked with the browser's colour picker (the system colour wheel on a Mac).
// Saved as a hex string; nothing saved means the brand gold (--arc-brand in app/theme.css).
const STORAGE_KEY = "seams.arc-color";
const HEX = /^#[0-9a-f]{6}$/i;

// Point --arc at the chosen colour, so every Arc in the app (and the loading bar) follows.
// app/layout.tsx does the same before paint, so the loading screen starts in the right colour.
function apply(color: string | null) {
  const root = document.documentElement.style;
  if (color) root.setProperty("--arc", color);
  else root.removeProperty("--arc");
}

// Used when storage is blocked, so the choice still holds for this visit.
let memory: string | null = null;

function saved(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && HEX.test(value) ? value : null;
  } catch {
    return memory;
  }
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function choose(color: string | null) {
  memory = color;
  try {
    if (color) localStorage.setItem(STORAGE_KEY, color);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or storage off: `memory` keeps it for this visit.
  }
  listeners.forEach((fn) => fn());
}

function brandColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--arc-brand").trim().toLowerCase();
}
const noSubscribe = () => () => {};

interface Props {
  disabled?: boolean;
}

// Sits next to Arc in the map corner.
export default function ArcColorPicker({ disabled }: Props) {
  const color = useSyncExternalStore(subscribe, saved, () => null);
  const brand = useSyncExternalStore(noSubscribe, brandColor, () => null);
  useEffect(() => apply(color), [color]);

  const custom = color !== null;

  return (
    <div className="flex items-center gap-2">
      {/* A rainbow ring around the current colour. The real input sits on top, see-through, so a click opens the picker. */}
      <span
        className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full shadow-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
          disabled ? "opacity-50" : "transition-transform hover:scale-110"}`}
        style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
      >
        <span className="h-4 w-4 rounded-full border-2 border-surface bg-arc" />
        <input
          type="color"
          aria-label="Arc's colour"
          title="Change Arc's colour"
          disabled={disabled}
          // The input needs a hex value; with nothing saved, show the brand gold.
          value={color ?? brand ?? "#000000"}
          onChange={(e) => choose(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </span>
      {custom && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => choose(null)}
          title="Back to Arc's gold"
          className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-muted shadow-sm hover:text-text"
        >
          Reset
        </button>
      )}
    </div>
  );
}
