"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadData, type SeamsData } from "@/lib/data";
import FilterRow from "./FilterRow";
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
  const map = useRef<MapHandle>(null);
  const mascot = useRef<MascotHandle>(null);
  const sleeping = useRef(false);
  const reactionToken = useRef(0);

  const play = useCallback((name: MascotReaction) => {
    sleeping.current = name === "sleep";
    return mascot.current?.play(name) ?? Promise.resolve();
  }, []);

  // Load data.
  const fetchData = useCallback(() => {
    loadData()
      .then((data) => {
        setLoad({ status: "ready", data });
        void play("idle");
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
      const token = ++reactionToken.current;
      if (!id || !data) {
        void play("idle");
        return;
      }
      const o = data.overlaps.find((x) => x.id === id);
      if (!o) return;
      map.current?.fitBounds(overlapBounds(o, sides(o, index)));
      void play(o.tier <= 2 ? "alert" : "found").then(() => {
        if (o.time_overlap && token === reactionToken.current) void play("wide");
      });
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
        />

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
          <header className="flex items-baseline justify-between">
            <h1 className="text-lg font-bold tracking-tight">Seams</h1>
            <span className="text-xs text-muted">Where planned grid projects meet</span>
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
              <EmptyState filtered={hasFilters(filters)} onClear={() => changeFilters(EMPTY_FILTERS)} />
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

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear(): void }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center" role="status">
      <p className="text-sm font-medium">No overlaps match</p>
      <p className="mt-1 text-xs text-muted">
        {filtered ? "Try a wider date range or turn off “Time overlaps only”." : "The data has no overlaps yet."}
      </p>
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
