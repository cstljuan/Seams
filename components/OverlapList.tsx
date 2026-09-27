"use client";

import { useRef, useState } from "react";
import { buildBrief, scheduleText } from "./brief";
import type { Overlap, Project } from "@/lib/data";
import { ChevronIcon, ClockIcon, InfoIcon } from "./icons";
import {
  TIER_LABELS,
  accuracy,
  cleanText,
  formatDate,
  formatDays,
  formatKm,
  formatUsd,
  sides,
  sources,
  utilityVar,
  type ProjectIndex,
} from "./overlaps";

interface Props {
  overlaps: Overlap[];
  index: ProjectIndex;
  selectedId: string | null;
  onSelect(id: string | null): void;
}

// Up/Down/Home/End move between rows, Enter or Space opens a row, Escape closes it.
export default function OverlapList({ overlaps, index, selectedId, onSelect }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = overlaps.length - 1;
    const go = (j: number) => {
      e.preventDefault();
      buttons.current[j]?.focus();
    };
    if (e.key === "ArrowDown") go(Math.min(last, i + 1));
    else if (e.key === "ArrowUp") go(Math.max(0, i - 1));
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(last);
    else if (e.key === "Escape" && selectedId) {
      e.preventDefault();
      onSelect(null);
    }
  }

  return (
    <ol aria-label="Overlaps, ranked" className="flex flex-col gap-2">
      {overlaps.map((o, i) => {
        const pair = sides(o, index);
        const open = o.id === selectedId;
        const [gpc, desc] = pair ?? [];
        return (
          <li
            key={o.id}
            className={`overflow-hidden rounded-xl border bg-surface transition-shadow ${
              open ? "border-accent shadow-md" : "border-line"
            }`}
          >
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              aria-expanded={open}
              aria-controls={`${o.id}-details`}
              onClick={() => onSelect(open ? null : o.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left hover:bg-hover focus-visible:-outline-offset-2"
            >
              <span className="w-1 shrink-0 rounded-full" style={{ background: `var(--tier-${o.tier})` }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">#{o.rank}</span>
                  <span className="text-sm font-semibold">
                    <span style={{ color: utilityVar("GPC") }}>GPC</span>
                    <span className="text-muted" aria-label="to">
                      {" → "}
                    </span>
                    <span style={{ color: utilityVar("DESC") }}>DESC</span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
                    <span className="font-mono text-xs text-text">
                      {formatKm(o.distance_km)}
                      {o.approximate && <span className="ml-1 font-sans text-muted">approx.</span>}
                    </span>
                    {o.time_overlap && <ClockIcon className="h-4 w-4 text-accent" label="In-service dates within a year" />}
                    <span title={`Tier ${o.tier}: ${TIER_LABELS[o.tier]}`}>
                      <InfoIcon className="h-4 w-4" label={`Tier ${o.tier}`} />
                    </span>
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted" title={gpc && cleanText(gpc.properties.name)}>
                  {gpc ? cleanText(gpc.properties.name) : o.b}
                </span>
                <span className="block truncate text-xs text-muted" title={desc && cleanText(desc.properties.name)}>
                  {desc ? cleanText(desc.properties.name) : o.a}
                </span>
              </span>
              <ChevronIcon
                className={`h-4 w-4 shrink-0 self-center text-muted transition-transform ${open ? "rotate-90" : ""}`}
              />
            </button>
            {open && (
              <div id={`${o.id}-details`} role="region" aria-label={`Details for overlap ${o.rank}`}>
                {pair ? <Details overlap={o} pair={pair} /> : <p className="px-4 pb-3 text-xs text-muted">Project data missing.</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Details({ overlap: o, pair }: { overlap: Overlap; pair: [Project, Project] }) {
  const acc = accuracy(pair);
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 border-t border-line px-4 py-3 text-xs">
      {pair.map((p) => (
        <Row key={p.properties.id} label={p.properties.utility}>
          <span className="block font-medium" style={{ color: utilityVar(p.properties.utility) }}>
            {p.properties.utility_name}
          </span>
          <span className="block">{cleanText(p.properties.name)}</span>
        </Row>
      ))}
      <Row label="Closest distance">
        <span className="font-mono">{formatKm(o.distance_km)}</span>
        {o.approximate && <span className="text-muted"> (approx.)</span>}
      </Row>
      <Row label="Tier">
        <span className="mr-1.5 inline-block rounded px-1.5 font-mono font-semibold text-surface" style={{ background: `var(--tier-${o.tier})` }}>
          {o.tier}
        </span>
        {TIER_LABELS[o.tier]}
      </Row>
      <Row label="Time gap">
        <span className="font-mono">{formatDays(o.time_gap_days)}</span>
        {o.time_overlap ? (
          <span className="ml-1.5 inline-flex items-center gap-1 text-accent">
            <ClockIcon className="h-3.5 w-3.5" /> schedule match
          </span>
        ) : (
          <span className="ml-1.5 text-muted">not a schedule match</span>
        )}
        <span className="mt-0.5 block text-muted">{scheduleText(o)}</span>
      </Row>
      <Row label="In service">
        {pair.map((p) => (
          <span key={p.properties.id} className="block">
            <span className="text-muted">{p.properties.utility}</span>{" "}
            <span className="font-mono">{formatDate(p.properties.in_service)}</span>
          </span>
        ))}
      </Row>
      <Row label="Location accuracy">
        <span className="font-medium">{acc}</span>
        <span className="text-muted">
          {acc === "Exact" ? " (both from real line geometry)" : " (at least one side is an approximate point)"}
        </span>
      </Row>
      <Row label="Cost of not coordinating">
        {o.cost ? (
          <>
            <span className="font-mono">
              {formatUsd(o.cost.p10)} to {formatUsd(o.cost.p90)}
            </span>
            <span className="text-muted"> (P10 to P90, median {formatUsd(o.cost.p50)})</span>
            <span className="mt-0.5 block text-muted">Model estimate from public benchmarks. Not a utility quote or guaranteed savings.</span>
          </>
        ) : (
          <span className="text-muted">Unavailable: the cost model has no estimate for this pair.</span>
        )}
      </Row>
      <Row label="Sources">
        {sources(pair).map((s, i) => (
          <span key={i} className="block">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline">
                {s.doc}
              </a>
            ) : (
              s.doc
            )}
            {s.page != null && <span className="text-muted">, p. {s.page}</span>}
          </span>
        ))}
      </Row>
      <dt className="sr-only">Actions</dt>
      <dd className="col-span-2 pt-1">
        <BriefActions overlap={o} pair={pair} />
      </dd>
    </dl>
  );
}

// Copy or download a plain-text coordination brief. Nothing leaves the browser.
function BriefActions({ overlap, pair }: { overlap: Overlap; pair: [Project, Project] }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const text = () => buildBrief(overlap, pair);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `seams-brief-${overlap.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const btn = "rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium hover:bg-hover active:translate-y-px";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">Coordination brief</span>
      <button type="button" onClick={copy} className={btn}>
        {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
      </button>
      <button type="button" onClick={download} className={btn}>
        Download .md
      </button>
      <span className="w-full text-muted">A draft for people to review. Nothing is sent or saved.</span>
      <span className="sr-only" aria-live="polite">
        {copied === "copied" ? "Brief copied" : copied === "failed" ? "Could not copy" : ""}
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
