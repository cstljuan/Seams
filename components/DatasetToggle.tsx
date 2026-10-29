"use client";

import type { Dataset } from "@/lib/dataset";

interface Props {
  dataset: Dataset;
  onChange(next: Dataset): void;
  disabled?: boolean;
}

const OPTIONS: { id: Dataset; label: string; hint: string }[] = [
  { id: "illustrative", label: "Illustrative", hint: "About 800 made-up projects on real US towns" },
  { id: "sample", label: "Sperry sample", hint: "The 10 real projects from the GridLock sample" },
];

// Switches between the large illustrative dataset and the real Sperry sample.
// The illustrative one always carries a label, so nobody mistakes it for real plans.
export default function DatasetToggle({ dataset, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Dataset" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-0.5 text-xs">
        {OPTIONS.map((o) => {
          const on = o.id === dataset;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.hint}
              disabled={disabled}
              onClick={() => !on && onChange(o.id)}
              className={`rounded-md px-2 py-1.5 font-medium transition-colors disabled:opacity-50 ${
                on ? "bg-accent text-surface" : "text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {dataset === "illustrative" && (
        <p className="text-[11px] leading-snug text-muted">
          <span className="mr-1 rounded border border-tier-3 px-1 font-semibold uppercase tracking-wide text-text">Illustrative data</span>
          Made-up plans on real towns. Not real utility projects.
        </p>
      )}
    </div>
  );
}
