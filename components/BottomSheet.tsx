"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type SheetStop = "peek" | "half" | "full";

// Peek is a fixed strip; half and full are shares of the screen.
export const PEEK_PX = 124;
const TOP_GAP_PX = 56;
const ORDER: SheetStop[] = ["peek", "half", "full"];

function stopHeight(stop: SheetStop, screen: number): number {
  if (stop === "peek") return PEEK_PX;
  if (stop === "half") return Math.round(screen * 0.5);
  return screen - TOP_GAP_PX;
}

interface Props {
  stop: SheetStop;
  onStop(stop: SheetStop): void;
  // Always visible under the handle, even at peek.
  summary: ReactNode;
  children: ReactNode;
}

// The phone panel: drag the handle (or tap it) between peek, half and full, like a maps app.
// Only the handle area drags, so the list inside scrolls normally.
export default function BottomSheet({ stop, onStop, summary, children }: Props) {
  const [screen, setScreen] = useState(800);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);

  useEffect(() => {
    const read = () => setScreen(window.innerHeight);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const height = drag ?? stopHeight(stop, screen);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      // Buttons in the summary (Close, Overview) work as buttons, not as a handle tap.
      if ((e.target as Element).closest("button, a, input, select")) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      start.current = { y: e.clientY, h: stopHeight(stop, screen), t: performance.now(), moved: false };
    },
    [stop, screen],
  );
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = s.y - e.clientY;
      if (Math.abs(dy) > 4) s.moved = true;
      if (s.moved) setDrag(Math.max(PEEK_PX * 0.7, Math.min(screen - TOP_GAP_PX, s.h + dy)));
    },
    [screen],
  );
  const onUp = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (!s.moved) {
        // Tap on the handle: step up, and from full go back to peek.
        onStop(ORDER[(ORDER.indexOf(stop) + 1) % ORDER.length]);
        setDrag(null);
        return;
      }
      const dy = s.y - e.clientY;
      const speed = dy / Math.max(1, performance.now() - s.t); // px per ms, up is positive
      const h = s.h + dy;
      // A quick flick moves one stop in that direction; otherwise snap to the nearest.
      let next: SheetStop;
      if (Math.abs(speed) > 0.6) {
        const i = ORDER.indexOf(stop) + (speed > 0 ? 1 : -1);
        next = ORDER[Math.max(0, Math.min(ORDER.length - 1, i))];
      } else {
        next = ORDER.reduce((best, st) => (Math.abs(stopHeight(st, screen) - h) < Math.abs(stopHeight(best, screen) - h) ? st : best));
      }
      setDrag(null);
      onStop(next);
    },
    [stop, screen, onStop],
  );

  return (
    <section
      id="sidebar"
      aria-label="Overlaps"
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-2xl border-t border-line bg-bg shadow-[0_-8px_30px_rgba(0,0,0,0.25)] ${
        drag === null ? "transition-[height] duration-300 ease-out motion-reduce:transition-none" : ""
      }`}
      style={{ height, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`Panel ${stop}. Tap to resize.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onStop(ORDER[(ORDER.indexOf(stop) + 1) % ORDER.length]);
          }
        }}
        className="shrink-0 cursor-grab touch-none select-none px-4 pb-2 pt-2 active:cursor-grabbing"
      >
        <span aria-hidden className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-line" />
        {summary}
      </div>
      <div className={`min-h-0 flex-1 ${stop === "peek" && drag === null ? "overflow-hidden" : "overflow-y-auto overscroll-contain"}`}>{children}</div>
    </section>
  );
}
