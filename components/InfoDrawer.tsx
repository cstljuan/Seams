"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";
import { TIER_LABELS } from "./overlaps";

export type InfoTopic = "how" | "data";

// Slides over the map from the left. Escape or the close button returns focus to where it was.
export default function InfoDrawer({ topic, onClose }: { topic: InfoTopic | null; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!topic) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
  }, [topic, onClose]);

  if (!topic) return null;
  const title = topic === "how" ? "How Seams works" : "Data and methodology";

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      className="absolute inset-y-3 left-3 z-20 flex w-[400px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl outline-none"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-text">
          <CloseIcon className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
        {topic === "how" ? <How /> : <Data />}
      </div>
    </div>
  );
}

function How() {
  return (
    <>
      <p>
        Seams finds places where two utilities plan grid work close together, so they can coordinate before crews,
        outages and permits collide.
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>The map opens on the sample project region. Markers are coloured by utility: DESC and Georgia Power (GPC).</li>
        <li>The right panel ranks overlapping pairs by tier (distance), then by schedule.</li>
        <li>Narrow the list with place search, an in-service date range, or “Time overlaps only”.</li>
        <li>Open a pair to see distance, schedule, location accuracy, a cost range and sources.</li>
        <li>Copy or download a coordination brief to share with the people who can check it.</li>
      </ol>
      <p className="text-muted">
        Arc, the lightning bolt, reacts to what happens: thinking while data loads, pointing when you open a pair,
        warning on a schedule match, puzzled when filters hide everything, asleep when you step away. Click Arc for
        tips, drag him, or press and hold for a squeeze.
      </p>
      <p className="text-muted">Keyboard: Up and Down move through the list, Enter opens a pair, Escape closes it.</p>
    </>
  );
}

function Data() {
  return (
    <>
      <Section title="Projects">
        10 planned transmission projects (5 DESC, 5 GPC) from the Sperry Tech GridLock sample package
        (Projects_Overlaps.xlsx). Locations are substation points or midpoints between two substations, not surveyed
        line routes, so every distance is approximate.
      </Section>
      <Section title="Overlap tiers">
        <ul className="space-y-1">
          {([1, 2, 3, 4] as const).map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1.5 h-1 w-4 shrink-0 rounded-full" style={{ background: `var(--tier-${t})` }} />
              <span>
                <span className="font-mono">{t}</span> {TIER_LABELS[t]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted">Tiers come from the Sperry challenge and use closest distance between the two projects.</p>
      </Section>
      <Section title="Schedule match">
        A pair is a schedule match when the two in-service dates are within 365 days. The data has no construction
        start dates, so this does not prove the builds happen at the same time.
      </Section>
      <Section title="Cost of not coordinating">
        A Monte Carlo range (P10, P50, P90) built from public benchmarks: MISO MTEP transmission cost guides, ATRI
        trucking costs, LBNL outage-cost research and contractor mobilization norms. It is a model estimate, not a
        utility quote. Pairs share projects, so ranges should not be added together.
      </Section>
      <Section title="Basemap">OpenFreeMap tiles with OpenStreetMap data. If tiles fail, the ranked list still works.</Section>
      <Section title="What Seams does not do">
        It does not contact utilities, save plans, or confirm routes. Briefs are drafts for people to check.
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div>{children}</div>
    </section>
  );
}
