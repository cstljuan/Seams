"use client";

import { useState } from "react";
import type { ProjectType, UtilityInfo } from "@/lib/data";
import { MarkerShape } from "./MapView";

const TYPES: ProjectType[] = ["line", "substation", "rebuild", "reconductor", "other"];

interface Props {
  types: Set<ProjectType>;
  utilities: UtilityInfo[];
  // The large made-up dataset is on, so the legend says so.
  illustrative: boolean;
  // Phones: a small button that opens the legend, so it does not cover the map.
  compact?: boolean;
}

export default function MapLegend({ types, utilities, illustrative, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const shown = TYPES.filter((t) => types.has(t));
  const two = utilities.length <= 2;
  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto min-h-9 rounded-full border border-line bg-surface/95 px-3 text-[11px] font-medium shadow-sm"
      >
        {illustrative ? "Illustrative · Legend" : "Legend"}
      </button>
    );
  }
  return (
    // On phones, tap the open legend to fold it away again.
    <div
      onClick={compact ? () => setOpen(false) : undefined}
      className="pointer-events-auto rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs shadow-sm"
    >
      {illustrative && (
        <p className="mb-1.5 font-semibold uppercase tracking-wide text-[10px] text-muted">
          Illustrative data · {utilities.length} utilities
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {two ? (
          utilities.map((u) => (
            <span key={u.code} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${u.code === "DESC" ? "bg-utility-a" : "bg-utility-b"}`} /> {u.code}
            </span>
          ))
        ) : (
          <span className="flex items-center gap-1.5" title="The two sides of an open pair get their own colours">
            <span className="h-2.5 w-2.5 rounded-full bg-muted" /> Project
          </span>
        )}
        {shown.length > 0 &&
          shown.map((t) => (
            <span key={t} className="flex items-center gap-1 text-muted">
              <span className="text-muted">
                <MarkerShape type={t} size={10} />
              </span>
              {t}
            </span>
          ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-muted">
        <span>Tier</span>
        {([1, 2, 3, 4] as const).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className="h-1 w-4 rounded-full" style={{ background: `var(--tier-${t})` }} />
            <span className="font-mono">{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
