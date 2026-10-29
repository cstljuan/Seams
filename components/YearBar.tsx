"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "./icons";
import { useReducedMotion } from "./settings";

interface Props {
  range: [number, number];
  // The year shown; null means every year (nothing ghosted).
  year: number | null;
  onChange(year: number | null): void;
}

const STEP_MS = 900;

// The time bar for the 3D time view, after the Tokyo Last Train Atlas: pick a year, or press play to
// watch the grid get built. Projects in service after the year are ghosted on the map.
export default function YearBar({ range: [from, to], year, onChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const shown = year ?? to;
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  useEffect(() => {
    if (!playing) return;
    let y = year === null || year >= to ? from : year;
    onChange(y);
    timer.current = setInterval(() => {
      y += 1;
      if (y > to) {
        setPlaying(false);
        onChange(null);
        return;
      }
      onChange(y);
    }, reduced ? STEP_MS / 3 : STEP_MS);
    return () => clearInterval(timer.current);
    // Only (re)start when play is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="pointer-events-auto flex w-full max-w-[640px] items-center gap-3 rounded-2xl border border-line bg-surface/95 px-3 py-2.5 shadow-lg">
      <div className="w-20 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">In service by</p>
        <p className="font-mono text-2xl font-semibold leading-none" aria-live="polite">
          {year === null ? "All" : shown}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={from}
          max={to}
          step={1}
          value={shown}
          aria-label="Year"
          onChange={(e) => {
            setPlaying(false);
            const v = Number(e.target.value);
            onChange(v >= to ? null : v);
          }}
          className="w-full accent-[var(--accent)]"
        />
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted" aria-hidden>
          {years.filter((y, i) => i % 2 === 0 || y === to).map((y) => (
            <span key={y} className={y === shown ? "font-semibold text-text" : ""}>
              {y}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause" : "Play through the years"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-text text-surface hover:opacity-90"
      >
        {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
      </button>
      {year !== null && (
        <button type="button" onClick={() => { setPlaying(false); onChange(null); }} className="shrink-0 rounded-full border border-line px-3 py-2 text-xs hover:bg-hover">
          All years
        </button>
      )}
    </div>
  );
}
