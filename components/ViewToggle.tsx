"use client";

import type { MapView3D } from "./map3d";

const OPTIONS: { id: MapView3D; label: string; hint: string }[] = [
  { id: "flat", label: "2D", hint: "Flat map" },
  { id: "time", label: "3D time", hint: "Height shows when each project goes into service" },
  { id: "utility", label: "3D utility", hint: "Each utility gets its own floor" },
];

interface Props {
  view: MapView3D;
  onChange(next: MapView3D): void;
  // Shown under the toggle in 3D, so the height always has a key.
  years: [number, number] | null;
  utilityCount: number;
}

// Picks the map view, like the Tokyo Last Train Atlas's height switch. Sits top right, next to the zoom buttons.
export default function ViewToggle({ view, onChange, years, utilityCount }: Props) {
  const caption =
    view === "time" && years
      ? `Height: in service ${years[0]} (low) to ${years[1]} (high). Tall stitch = far apart in time.`
      : view === "utility"
        ? `Height: one floor per utility (${utilityCount}), A to Z from the ground up.`
        : null;
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      <div role="radiogroup" aria-label="Map view" className="flex gap-0.5 rounded-xl border border-line bg-surface/95 p-1 text-xs shadow-md">
        {OPTIONS.map((o) => {
          const on = o.id === view;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.hint}
              onClick={() => !on && onChange(o.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors ${
                on ? "bg-accent text-surface" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {caption && (
        <p className="max-w-64 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-right text-[11px] leading-snug text-muted shadow-sm">
          {caption}
        </p>
      )}
    </div>
  );
}
