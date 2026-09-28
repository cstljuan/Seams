"use client";

import { useEffect, useSyncExternalStore } from "react";

// Names match the --arc-<name> tokens in app/theme.css. The first one is the default.
const COLORS = ["gold", "coral", "teal", "blue", "violet", "pink"] as const;
type ArcColor = (typeof COLORS)[number];

const STORAGE_KEY = "seams.arc-color";

function isArcColor(value: string | null): value is ArcColor {
  return COLORS.includes(value as ArcColor);
}

// Point --arc at the chosen token, so every Arc in the app (and the loading bar) follows.
function apply(color: ArcColor) {
  const root = document.documentElement.style;
  if (color === COLORS[0]) root.removeProperty("--arc");
  else root.setProperty("--arc", `var(--arc-${color})`);
}

function saved(): ArcColor {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isArcColor(value) ? value : COLORS[0];
  } catch {
    return COLORS[0];
  }
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface Props {
  disabled?: boolean;
  // True while the pointer or focus is on the picker, so the screen can wait.
  onBusy?(busy: boolean): void;
}

export default function ArcColorPicker({ disabled, onBusy }: Props) {
  const color = useSyncExternalStore(subscribe, saved, () => COLORS[0]);

  useEffect(() => apply(color), [color]);

  function choose(c: ArcColor) {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // Private mode or storage off: the colour still applies for this visit.
      apply(c);
    }
    listeners.forEach((fn) => fn());
  }

  return (
    <div
      role="radiogroup"
      aria-label="Arc colour"
      className="flex gap-2"
      onPointerEnter={() => onBusy?.(true)}
      onPointerLeave={() => onBusy?.(false)}
      onFocus={() => onBusy?.(true)}
      onBlur={() => onBusy?.(false)}
    >
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={color === c}
          aria-label={c}
          title={c}
          disabled={disabled}
          onClick={() => choose(c)}
          className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? "border-text" : "border-transparent"}`}
          style={{ background: `var(--arc-${c})` }}
        />
      ))}
    </div>
  );
}
