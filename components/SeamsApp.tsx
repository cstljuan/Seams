"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadData, type SeamsData } from "@/lib/data";
import AppMenu from "./AppMenu";
import FilterRow from "./FilterRow";
import InfoDrawer, { type InfoTopic } from "./InfoDrawer";
import { ChevronIcon } from "./icons";
import LocationSearch from "./LocationSearch";
import MapLegend from "./MapLegend";
import type { MapHandle } from "./MapView";
import Mascot, { type MascotHandle, type MascotReaction } from "./Mascot";
import OverlapList from "./OverlapList";
import { EMPTY_FILTERS, filterOverlaps, hasFilters, inRange, indexProjects, overlapBounds, sides, type Filters } from "./overlaps";
import type { Place } from "./places";

// The map needs the browser, so skip it on the server.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg" />,
});

const IDLE_SLEEP_MS = 60_000;
const THINK_MS = 450;

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SeamsData };

export default function SeamsApp() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [info, setInfo] = useState<InfoTopic | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const map = useRef<MapHandle>(null);
  const mascot = useRef<MascotHandle>(null);
  const sleeping = useRef(false);
  const reactionToken = useRef(0);

  const play = useCallback((name: MascotReaction) => {
    sleeping.current = name === "sleep";
    return mascot.current?.play(name) ?? Promise.resolve();
  }, []);

  // Load data. Arc thinks while it loads, then gives a short happy nod.
  const fetchData = useCallback(() => {
    void play("thinking");
    loadData()
      .then((data) => {
        setLoad({ status: "ready", data });
        void play(data.overlaps.length ? "happy" : "confused");
      })
      .catch((err: unknown) => {
        setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
        void play("error");
      });
  }, [play]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    fetchData();
  }, [fetchData]);

  const data = load.status === "ready" ? load.data : null;
  const index = useMemo(() => indexProjects(data?.projects ?? []), [data]);
  const visible = useMemo(() => (data ? filterOverlaps(data.overlaps, index, filters) : []), [data, index, filters]);
  const selected = visible.find((o) => o.id === selectedId) ?? null;

  const dimmedProjectIds = useMemo(() => {
    const out = new Set<string>();
    if (!data || (!filters.start && !filters.end)) return out;
    for (const p of data.projects) if (!inRange(p.properties.in_service, filters.start, filters.end)) out.add(p.properties.id);
    return out;
  }, [data, filters.start, filters.end]);

  const projectTypes = useMemo(() => new Set(data?.projects.map((p) => p.properties.type) ?? []), [data]);

  // Change filters. Drop the selection if the new filters hide it.
  // The mascot thinks while the list updates, then idles, or looks confused if nothing matches.
  const changeFilters = useCallback(
    (next: Filters) => {
      setFilters(next);
      if (!data) return;
      const nextVisible = filterOverlaps(data.overlaps, index, next);
      if (selectedId && !nextVisible.some((o) => o.id === selectedId)) setSelectedId(null);
      const token = ++reactionToken.current;
      void play("thinking");
      setTimeout(() => {
        if (token === reactionToken.current) void play(nextVisible.length === 0 ? "confused" : "idle");
      }, THINK_MS);
    },
    [selectedId, data, index, play],
  );

  // Idle for 60 s: sleep. Any input wakes it.
  useEffect(() => {
    let timer = setTimeout(() => void play("sleep"), IDLE_SLEEP_MS);
    const wake = () => {
      clearTimeout(timer);
      if (sleeping.current) void play("idle");
      timer = setTimeout(() => void play("sleep"), IDLE_SLEEP_MS);
    };
    const events = ["pointerdown", "keydown", "wheel", "pointermove"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [play]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      ++reactionToken.current;
      if (!id || !data) {
        void play("idle");
        return;
      }
      const o = data.overlaps.find((x) => x.id === id);
      if (!o) return;
      map.current?.fitBounds(overlapBounds(o, sides(o, index)));
      // Warn only for a real schedule match or a touching/very close pair. Otherwise just point at it.
      void play(o.time_overlap || o.tier <= 2 ? "alert" : "found");
    },
    [data, index, play],
  );

  // Clicking a marker opens that project's best visible overlap, or just zooms to it.
  const onProjectClick = useCallback(
    (projectId: string) => {
      const best = visible.find((o) => o.a === projectId || o.b === projectId);
      if (best) {
        select(best.id);
        return;
      }
      const p = index.get(projectId);
      if (p) map.current?.flyTo(p.geometry.type === "Point" ? p.geometry.coordinates : p.geometry.coordinates[0], 10);
    },
    [visible, index, select],
  );

  const onPlace = useCallback((place: Place) => {
    if (place.bbox) {
      const [w, s, e, n] = place.bbox;
      map.current?.fitBounds([
        [w, s],
        [e, n],
      ]);
    } else {
      map.current?.flyTo(place.center, 10);
    }
  }, []);

  const resetDemo = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSelectedId(null);
    setInfo(null);
    setSidebarOpen(true);
    ++reactionToken.current;
    map.current?.overview();
    void play("idle");
  }, [play]);

  const focusSelected = useCallback(() => {
    if (selected) map.current?.fitBounds(overlapBounds(selected, sides(selected, index)));
  }, [selected, index]);

  // Escape closes the open pair when focus is not in a field or the list (the list handles its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || info || !selectedId) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, [role=menu], #sidebar ol")) return;
      select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [info, selectedId, select]);

  const onSearchBusy = useCallback(
    (busy: boolean) => {
      ++reactionToken.current;
      void play(busy ? "thinking" : "idle");
    },
    [play],
  );

  return (
    <main className="flex h-full min-w-[1024px] bg-bg text-text">
      <section className="relative min-w-0 flex-1" aria-label="Map">
        <MapView
          ref={map}
          projects={data?.projects ?? []}
          overlaps={visible}
          selectedId={selected?.id ?? null}
          dimmedProjectIds={dimmedProjectIds}
          onSelect={select}
          onProjectClick={onProjectClick}
          onTileError={() => setTilesFailed(true)}
        />

        {load.status === "loading" && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
            <p role="status" className="rounded-full border border-line bg-surface px-4 py-1.5 text-xs shadow-sm">
              Loading projects and overlaps…
            </p>
          </div>
        )}

        {tilesFailed && (
          <div className="absolute inset-x-0 top-4 flex justify-center">
            <p role="alert" className="rounded-xl border border-tier-2 bg-surface px-4 py-2 text-xs shadow-sm">
              Map tiles could not load. The ranked list on the right still works.
            </p>
          </div>
        )}

        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-line bg-surface/95 p-1 text-xs shadow-md">
          <button type="button" onClick={() => map.current?.overview()} className="rounded-lg px-3 py-1.5 font-medium hover:bg-hover">
            Overview
          </button>
          <button
            type="button"
            onClick={focusSelected}
            disabled={!selected}
            className="rounded-lg px-3 py-1.5 font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Focus selected
          </button>
          <button type="button" onClick={resetDemo} className="rounded-lg px-3 py-1.5 font-medium hover:bg-hover">
            Reset view
          </button>
        </div>

        <InfoDrawer topic={info} onClose={() => setInfo(null)} />

        <div className="pointer-events-none absolute left-3 top-3">
          <MapLegend types={projectTypes} />
        </div>

        <div className="pointer-events-none absolute bottom-6 left-3">
          <Mascot ref={mascot} size={96} />
        </div>

        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          className="absolute right-0 top-1/2 z-10 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-line bg-surface text-muted shadow-sm hover:text-text"
        >
          <ChevronIcon className={`h-4 w-4 transition-transform ${sidebarOpen ? "" : "rotate-180"}`} />
        </button>
      </section>

      <aside
        id="sidebar"
        aria-label="Overlaps"
        inert={!sidebarOpen}
        onTransitionEnd={() => map.current?.resize()}
        className={`flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-bg transition-[width] duration-300 ${
          sidebarOpen ? "w-[30%] min-w-[360px] max-w-[520px]" : "w-0 min-w-0 border-l-0"
        }`}
      >
        <div className="flex min-w-[360px] flex-col gap-3 border-b border-line p-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="m-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-full-light.svg" alt="Seams" className="h-8 w-auto dark:hidden" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-full-dark.svg" alt="Seams" className="hidden h-8 w-auto dark:block" />
              </h1>
              <span className="text-xs leading-tight text-muted">Where planned grid projects meet</span>
            </div>
            <AppMenu
              items={[
                { label: "Explore overlaps", onSelect: () => { setInfo(null); setSidebarOpen(true); } },
                { label: "How it works", onSelect: () => setInfo("how") },
                { label: "Data and methodology", onSelect: () => setInfo("data") },
                { label: "Reset demo", onSelect: resetDemo },
              ]}
            />
          </header>
          <LocationSearch onPlace={onPlace} onBusy={onSearchBusy} />
          <FilterRow filters={filters} onChange={changeFilters} />
        </div>

        <div className="flex min-h-0 min-w-[360px] flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <h2 className="text-sm font-semibold">
              Ranked overlaps
              {data && (
                <span className="ml-1.5 font-mono font-normal text-muted" aria-live="polite">
                  {visible.length === data.overlaps.length ? visible.length : `${visible.length} of ${data.overlaps.length}`}
                </span>
              )}
            </h2>
            {hasFilters(filters) && (
              <button type="button" onClick={() => changeFilters(EMPTY_FILTERS)} className="text-xs text-accent hover:underline">
                Clear filters
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {load.status === "loading" && <LoadingList />}
            {load.status === "error" && <ErrorState message={load.message} onRetry={retry} />}
            {data && visible.length === 0 && (
              <EmptyState filters={filters} onClear={() => changeFilters(EMPTY_FILTERS)} />
            )}
            {data && visible.length > 0 && (
              <OverlapList overlaps={visible} index={index} selectedId={selected?.id ?? null} onSelect={select} />
            )}
          </div>
        </div>
      </aside>
    </main>
  );
}

function LoadingList() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading overlaps…</span>
      <ul className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="animate-pulse rounded-xl border border-line bg-surface p-3">
            <div className="h-3 w-1/3 rounded bg-hover" />
            <div className="mt-2 h-2.5 w-4/5 rounded bg-hover" />
            <div className="mt-1.5 h-2.5 w-3/5 rounded bg-hover" />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-xs text-muted">Loading overlaps…</p>
    </div>
  );
}

// Say which filter hid everything, so the fix is obvious.
function emptyReason(f: Filters): string {
  const parts: string[] = [];
  if (f.start || f.end) parts.push(`no pair has both in-service dates ${f.start ? `after ${f.start}` : ""}${f.start && f.end ? " and " : ""}${f.end ? `before ${f.end}` : ""}`);
  if (f.timeOnly) parts.push("“Time overlaps only” keeps just pairs with in-service dates within a year");
  return parts.length ? `${parts.join("; ")}.` : "The data has no overlaps yet.";
}

function EmptyState({ filters, onClear }: { filters: Filters; onClear(): void }) {
  const filtered = hasFilters(filters);
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center" role="status">
      <p className="text-sm font-medium">No overlaps match</p>
      <p className="mt-1 text-xs text-muted">{filtered ? emptyReason(filters) : "The data has no overlaps yet."}</p>
      {filtered && (
        <button type="button" onClick={onClear} className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:bg-hover">
          Clear filters
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="rounded-xl border border-tier-1 bg-surface px-4 py-6 text-center" role="alert">
      <p className="text-sm font-medium">Could not load the data</p>
      <p className="mt-1 break-words font-mono text-xs text-muted">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:bg-hover">
        Try again
      </button>
    </div>
  );
}
