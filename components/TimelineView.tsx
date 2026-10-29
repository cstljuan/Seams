"use client";

import type { Overlap } from "@/lib/data";
import { sideVar, sides, type ProjectIndex } from "./overlaps";

interface Props {
  overlaps: Overlap[];
  index: ProjectIndex;
  selectedId: string | null;
  onSelect(id: string | null): void;
}

const DAY = 86_400_000;
// Projects with no start date get a one-year window ending at in service, drawn lighter.
const GUESS_DAYS = 365;

function window(p: { start: string | null; in_service: string }): { from: number; to: number; guessed: boolean } {
  const to = Date.parse(p.in_service);
  const from = p.start ? Date.parse(p.start) : to - GUESS_DAYS * DAY;
  return { from, to, guessed: !p.start };
}

// Each pair as two build windows on one year axis, so time overlap reads at a glance:
// the shaded band is when both are being built. Tap a row to open the pair.
export default function TimelineView({ overlaps, index, selectedId, onSelect }: Props) {
  const rows = overlaps.flatMap((o) => {
    const pair = sides(o, index);
    if (!pair) return [];
    return [{ o, pair, w: pair.map((p) => window(p.properties)) as [ReturnType<typeof window>, ReturnType<typeof window>] }];
  });
  if (!rows.length) return null;
  const lo = new Date(Math.min(...rows.flatMap((r) => r.w.map((w) => w.from)))).getUTCFullYear();
  const hi = new Date(Math.max(...rows.flatMap((r) => r.w.map((w) => w.to)))).getUTCFullYear() + 1;
  const start = Date.UTC(lo, 0, 1);
  const span = Date.UTC(hi, 0, 1) - start;
  const x = (t: number) => `${((t - start) / span) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0.8, ((b - a) / span) * 100)}%`;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const step = ticks.length > 8 ? 2 : 1;

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-bg px-4 pb-1.5 pt-1">
        <div className="relative ml-24 h-4 font-mono text-[10px] text-muted" aria-hidden>
          {ticks
            .filter((_, i) => i % step === 0)
            .map((y) => (
              <span key={y} className="absolute -translate-x-1/2" style={{ left: x(Date.UTC(y, 0, 1)) }}>
                {String(y).slice(2)}
              </span>
            ))}
        </div>
      </div>
      <ol className="flex flex-col">
        {rows.map(({ o, pair, w }) => {
          const both = [Math.max(w[0].from, w[1].from), Math.min(w[0].to, w[1].to)];
          const open = o.id === selectedId;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onSelect(open ? null : o.id)}
                aria-pressed={open}
                aria-label={`Pair ${o.rank}, ${pair[0].properties.utility} and ${pair[1].properties.utility}`}
                className={`flex w-full items-center gap-2 rounded-lg py-1.5 text-left hover:bg-hover ${open ? "bg-hover" : ""}`}
              >
                <span className="w-22 shrink-0 truncate pl-1 text-[11px]">
                  <span className="font-mono text-muted">#{o.rank}</span>{" "}
                  <span style={{ color: sideVar(0) }}>{pair[0].properties.utility}</span>
                  <span className="text-muted">/</span>
                  <span style={{ color: sideVar(1) }}>{pair[1].properties.utility}</span>
                </span>
                <span className="relative h-5 min-w-0 flex-1 rounded bg-hover">
                  {both[0] < both[1] && (
                    <span className="absolute inset-y-0 rounded bg-accent/25" style={{ left: x(both[0]), width: width(both[0], both[1]) }} />
                  )}
                  {w.map((win, i) => (
                    <span
                      key={i}
                      className={`absolute h-1.5 rounded-full ${win.guessed ? "opacity-50" : ""}`}
                      style={{ top: i === 0 ? 4 : 11, left: x(win.from), width: width(win.from, win.to), background: sideVar(i as 0 | 1) }}
                    />
                  ))}
                  <span className={`absolute inset-y-0 left-0 w-1 rounded-l`} style={{ background: `var(--tier-${o.tier})` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Bars run from construction start to in service. Shaded: both being built at once. Faded bars have no start date in the
        data, so they show the year before in service.
      </p>
    </div>
  );
}
