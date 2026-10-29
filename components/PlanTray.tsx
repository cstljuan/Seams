"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { buildPlan } from "./brief";
import { formatKm, sides, type ProjectIndex } from "./overlaps";
import type { Overlap } from "@/lib/data";
import { plan } from "@/lib/plan";

interface Props {
  overlaps: Overlap[];
  index: ProjectIndex;
  onOpen(id: string): void;
}

// The coordination plan: a small pill with the count, opening a tray to review, reorder and export.
// Only pairs in the current dataset show; nothing is sent anywhere.
export default function PlanTray({ overlaps, index, onOpen }: Props) {
  const ids = useSyncExternalStore(plan.subscribe, plan.get, plan.serverSnapshot);
  const [open, setOpen] = useState(false);
  const byId = new Map(overlaps.map((o) => [o.id, o]));
  const items = ids.flatMap((id) => {
    const o = byId.get(id);
    const pair = o ? sides(o, index) : null;
    return o && pair ? [{ overlap: o, pair }] : [];
  });
  if (!items.length) return null;

  const download = () => {
    const url = URL.createObjectURL(new Blob([buildPlan(items)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `seams-plan-${items.length}-pairs.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const btn = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-hover";

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      {open && (
        <div className="w-[min(340px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Coordination plan</p>
            <button type="button" onClick={() => plan.clear()} className="text-xs text-muted hover:text-text">
              Clear
            </button>
          </div>
          <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {items.map(({ overlap: o, pair }, i) => (
              <li key={o.id} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs hover:bg-hover">
                <button type="button" onClick={() => onOpen(o.id)} className="min-w-0 flex-1 truncate text-left">
                  <span className="font-mono text-muted">#{o.rank}</span> {pair[0].properties.utility} and {pair[1].properties.utility}
                  <span className="ml-1 font-mono text-muted">{formatKm(o.distance_km)}</span>
                </button>
                <button type="button" disabled={i === 0} onClick={() => plan.move(o.id, -1)} aria-label="Move up" className="px-1 text-muted disabled:opacity-30">
                  ↑
                </button>
                <button type="button" disabled={i === items.length - 1} onClick={() => plan.move(o.id, 1)} aria-label="Move down" className="px-1 text-muted disabled:opacity-30">
                  ↓
                </button>
                <button type="button" onClick={() => plan.remove(o.id)} aria-label="Remove" className="px-1 text-muted hover:text-tier-1">
                  ×
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={download} className={btn}>
              Download .md
            </button>
            <Link href="/plan" className={btn}>
              Print or PDF
            </Link>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">Saved in this browser only. Each pair keeps its own cost range; they are not added up.</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-line bg-surface/95 px-3.5 py-2 text-xs font-semibold shadow-md"
      >
        Plan
        <span className="rounded-full bg-accent px-1.5 font-mono text-surface">{items.length}</span>
      </button>
    </div>
  );
}
