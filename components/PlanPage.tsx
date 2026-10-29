"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { loadData, type LngLat, type Project, type SeamsData } from "@/lib/data";
import { DEFAULT_DATASET, datasetChoice, type Dataset } from "@/lib/dataset";
import { plan } from "@/lib/plan";
import { scheduleText } from "./brief";
import { TIER_LABELS, accuracy, cleanText, formatDate, formatKm, formatUsd, indexProjects, projectCoords, sides } from "./overlaps";
import { ChevronIcon } from "./icons";

// A small drawing of one pair: both projects and the seam between them, fitted to the box.
// Plain SVG, so it prints sharp and needs no map tiles.
function PairSketch({ pair, closest, tier }: { pair: [Project, Project]; closest: [LngLat, LngLat]; tier: number }) {
  const pts = [...pair.flatMap(projectCoords), ...closest];
  const lat0 = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * k);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 0.01);
  const W = 160;
  const pad = 14;
  const at = ([lng, lat]: LngLat) => [pad + ((lng * k - x0) / span) * (W - pad * 2), W - pad - ((lat - y0) / span) * (W - pad * 2)];
  const path = (p: Project) => projectCoords(p).map((c) => at(c).join(",")).join(" ");
  const colours = ["var(--utility-b)", "var(--utility-a)"];
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="h-36 w-36 shrink-0 rounded-xl border border-line bg-bg" aria-hidden>
      {pair.map((p, i) =>
        p.geometry.type === "LineString" ? (
          <polyline key={i} points={path(p)} fill="none" stroke={colours[i]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <circle key={i} cx={at(p.geometry.coordinates)[0]} cy={at(p.geometry.coordinates)[1]} r={5} fill={colours[i]} />
        ),
      )}
      <line x1={at(closest[0])[0]} y1={at(closest[0])[1]} x2={at(closest[1])[0]} y2={at(closest[1])[1]} stroke={`var(--tier-${tier})`} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export default function PlanPage() {
  const ids = useSyncExternalStore(plan.subscribe, plan.get, plan.serverSnapshot);
  const dataset = (useSyncExternalStore(datasetChoice.subscribe, datasetChoice.get, () => null) ?? DEFAULT_DATASET) as Dataset;
  const [data, setData] = useState<SeamsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData(dataset).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [dataset]);

  const index = data ? indexProjects(data.projects) : null;
  const byId = new Map(data?.overlaps.map((o) => [o.id, o]) ?? []);
  const items = index
    ? ids.flatMap((id) => {
        const o = byId.get(id);
        const pair = o ? sides(o, index) : null;
        return o && pair ? [{ o, pair }] : [];
      })
    : [];
  const illustrative = items.some(({ pair }) => pair.some((p) => p.properties.synthetic));

  return (
    <main className="h-full overflow-y-auto bg-bg text-text print:h-auto print:overflow-visible">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-16 pt-6 sm:px-6">
        <header className="flex items-center justify-between gap-3 print:hidden">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-text">
            <ChevronIcon className="h-4 w-4 rotate-180" />
            Back to the map
          </Link>
          <button type="button" onClick={() => window.print()} disabled={!items.length} className="min-h-11 rounded-full bg-text px-5 text-sm font-semibold text-surface disabled:opacity-40">
            Print or save as PDF
          </button>
        </header>

        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full-light.svg" alt="Seams" className="mb-4 h-7 w-auto dark:hidden print:block" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full-dark.svg" alt="Seams" className="mb-4 hidden h-7 w-auto dark:block print:hidden" />
          <h1 className="text-3xl font-semibold leading-tight">Coordination plan</h1>
          <p className="mt-1 text-sm text-muted">
            {items.length} {items.length === 1 ? "pair" : "pairs"} · {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · Draft for
            human review. Nothing has been sent to any utility.
          </p>
          {illustrative && (
            <p className="mt-3 rounded-lg border border-tier-3 px-3 py-2 text-sm">
              <span className="font-semibold">Illustrative data.</span> These are made-up plans placed on real towns, not real utility projects.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-tier-1">Could not load the data: {error}</p>}
        {data && !items.length && (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            The plan is empty. Open a pair on the map and press “Add to plan”.
          </p>
        )}

        <ol className="flex flex-col gap-4">
          {items.map(({ o, pair }) => (
            <li key={o.id} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 break-inside-avoid">
              <PairSketch pair={pair} closest={o.closest_points} tier={o.tier} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">
                  <span className="font-mono text-muted">#{o.rank}</span> {pair[0].properties.utility_name} and {pair[1].properties.utility_name}
                </p>
                <ul className="mt-1 text-xs text-muted">
                  {pair.map((p) => (
                    <li key={p.properties.id}>
                      {p.properties.utility}: {cleanText(p.properties.name)}, in service {formatDate(p.properties.in_service)}
                    </li>
                  ))}
                </ul>
                <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">Distance</dt>
                  <dd className="font-mono">{formatKm(o.distance_km)}{o.approximate ? " (approx.)" : ""}</dd>
                  <dt className="text-muted">Tier</dt>
                  <dd>{o.tier}: {TIER_LABELS[o.tier]}</dd>
                  <dt className="text-muted">Schedule</dt>
                  <dd>{scheduleText(o, pair)}</dd>
                  <dt className="text-muted">Accuracy</dt>
                  <dd>{accuracy(pair)}</dd>
                  <dt className="text-muted">Cost range</dt>
                  <dd className="font-mono">{o.cost ? `${formatUsd(o.cost.p10)} to ${formatUsd(o.cost.p90)} (median ${formatUsd(o.cost.p50)})` : "Not estimated"}</dd>
                </dl>
              </div>
            </li>
          ))}
        </ol>
        {items.length > 1 && <p className="text-xs text-muted">Cost ranges are model estimates per pair and are not added together, because pairs can share a project.</p>}
      </div>
    </main>
  );
}
