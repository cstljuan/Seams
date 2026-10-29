"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadData } from "@/lib/data";
import { DEFAULT_DATASET, datasetChoice, type Dataset } from "@/lib/dataset";
import InfoDrawer, { type InfoTopic } from "./InfoDrawer";
import { ChevronIcon } from "./icons";
import MapLegend from "./MapLegend";
import ArcCorner, { type ArcCornerHandle } from "./ArcCorner";
import SidebarPanel, { type LoadState } from "./Sidebar";
import { mapViewChoice } from "./settings";
import { timeRange, type MapView3D } from "./map3d";
import ViewToggle from "./ViewToggle";
import YearBar from "./YearBar";
import ScopePicker, { stateName } from "./ScopePicker";
import BottomSheet, { PEEK_PX, type SheetStop } from "./BottomSheet";
import { useIsPhone } from "./useIsPhone";
import { involves } from "./explore";
import LoadingScreen from "./LoadingScreen";
import type { MapHandle, MapViewState } from "./MapView";
import type { MascotReaction } from "./Mascot";
import {
  EMPTY_FILTERS,
  filterOverlaps,
  formatKm,
  inRange,
  indexProjects,
  overlapBounds,
  sides,
  type Filters,
} from "./overlaps";
import type { Place } from "./places";

// The map needs the browser, so skip it on the server.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg" />,
});

const IDLE_SLEEP_MS = 60_000;
const LIST_FOLLOW_ZOOM = 5.5;
const THINK_MS = 450;
// If the base map is slow, stop waiting for it after the data is in. The list works without it.
const MAP_WAIT_MS = 4_000;

// What each tier means for the crews, in Arc's words. Short forms of TIER_LABELS.
const TIER_LINES: Record<1 | 2 | 3 | 4, string> = {
  1: "They touch or cross, so outages need planning together.",
  2: "Close enough to share land, access roads and permits.",
  3: "Close enough to share laydown yards and deliveries.",
  4: "Close enough to share crews and equipment.",
};


export default function SeamsApp() {
  const router = useRouter();
  const phone = useIsPhone();
  const [sheet, setSheet] = useState<SheetStop>("peek");
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const dataset = (useSyncExternalStore(datasetChoice.subscribe, datasetChoice.get, () => null) ?? DEFAULT_DATASET) as Dataset;
  const view = (useSyncExternalStore(mapViewChoice.subscribe, mapViewChoice.get, () => null) ?? "flat") as MapView3D;
  const [yearCursor, setYearCursor] = useState<number | null>(null);
  // The year bar: always in 3D time, on demand in the other views.
  const [yearsOpen, setYearsOpen] = useState(false);
  const showYears = view === "time" || yearsOpen;
  const activeYear = showYears ? yearCursor : null;
  const loadToken = useRef(0);
  // Set when the user switches datasets, so Arc says what changed once the new data is in.
  const announceSwitch = useRef(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Scope: one state, or "" for the whole country.
  const [scope, setScope] = useState("");
  // Spotlight: one utility, or "" for all.
  const [spotlight, setSpotlight] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [info, setInfo] = useState<InfoTopic | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapWaitOver, setMapWaitOver] = useState(false);
  const [booting, setBooting] = useState(true);
  const map = useRef<MapHandle>(null);
  const mascot = useRef<ArcCornerHandle>(null);
  const sleeping = useRef(false);
  const reactionToken = useRef(0);

  const play = useCallback((name: MascotReaction) => {
    sleeping.current = name === "sleep";
    return mascot.current?.play(name) ?? Promise.resolve();
  }, []);

  // Load data. Arc thinks while it loads, then gives a short happy nod.
  // A newer load (say, after a dataset switch) wins over an older one still in flight.
  const fetchData = useCallback(() => {
    const token = ++loadToken.current;
    void play("thinking");
    loadData(dataset)
      .then((data) => {
        if (token !== loadToken.current) return;
        setLoad({ status: "ready", data });
        void play(data.overlaps.length ? "happy" : "confused");
        if (announceSwitch.current) {
          announceSwitch.current = false;
          const n = data.overlaps.length.toLocaleString("en-US");
          mascot.current?.say(
            dataset === "illustrative"
              ? `Illustrative data: ${n} made-up pairs on real towns. Good for exploring, not real plans.`
              : `Sperry sample: the ${n} real pairs from the GridLock data.`,
            "happy",
          );
        }
      })
      .catch((err: unknown) => {
        if (token !== loadToken.current) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
        mascot.current?.say("I couldn't reach the data. Try again on the right.", "error");
      });
  }, [play, dataset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const changeDataset = useCallback((next: Dataset) => {
    announceSwitch.current = true;
    setSelectedId(null);
    setScope("");
    setSpotlight("");
    setLoad({ status: "loading" });
    datasetChoice.set(next);
  }, []);

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    fetchData();
  }, [fetchData]);

  const data = load.status === "ready" ? load.data : null;
  const index = useMemo(() => indexProjects(data?.projects ?? []), [data]);
  // A pair is in scope when either project is in the chosen state.
  const scopeStates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of data?.overlaps ?? []) {
      const states = new Set([index.get(o.a)?.properties.state, index.get(o.b)?.properties.state]);
      for (const st of states) if (st) counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [data, index]);
  const inScope = useCallback(
    (o: { a: string; b: string }) => !scope || index.get(o.a)?.properties.state === scope || index.get(o.b)?.properties.state === scope,
    [scope, index],
  );
  const visible = useMemo(
    () => (data ? filterOverlaps(data.overlaps, index, filters).filter((o) => inScope(o) && (!spotlight || involves(o, spotlight, index))) : []),
    [data, index, filters, inScope, spotlight],
  );
  // Zoomed in past this, the list shows only pairs whose seam is on screen, so it matches the map.
  const [mapView, setMapView] = useState<MapViewState | null>(null);
  const byYear = useMemo(() => {
    if (activeYear === null) return visible;
    return visible.filter((o) => {
      const ya = Number(index.get(o.a)?.properties.in_service.slice(0, 4));
      const yb = Number(index.get(o.b)?.properties.in_service.slice(0, 4));
      return Math.max(ya, yb) <= activeYear || o.id === selectedId;
    });
  }, [visible, activeYear, index, selectedId]);
  const listed = useMemo(() => {
    if (!mapView || mapView.zoom < LIST_FOLLOW_ZOOM) return byYear;
    const [w, s, e, n] = mapView.bounds;
    return byYear.filter((o) => {
      if (o.id === selectedId) return true;
      const lng = (o.closest_points[0][0] + o.closest_points[1][0]) / 2;
      const lat = (o.closest_points[0][1] + o.closest_points[1][1]) / 2;
      return lng >= w && lng <= e && lat >= s && lat <= n;
    });
  }, [byYear, mapView, selectedId]);
  const listFollows = !!mapView && mapView.zoom >= LIST_FOLLOW_ZOOM;

  // The map draws in-scope projects plus the partners they pair with across the state line.
  const mapProjects = useMemo(() => {
    if (!data) return [];
    if (!scope && !spotlight) return data.projects;
    // Scope keeps the state's projects; spotlight keeps the utility's. Plus every partner they pair with.
    const keep = new Set(
      data.projects
        .filter((p) => (!scope || p.properties.state === scope) && (!spotlight || p.properties.utility === spotlight))
        .map((p) => p.properties.id),
    );
    for (const o of visible) {
      keep.add(o.a);
      keep.add(o.b);
    }
    return data.projects.filter((p) => keep.has(p.properties.id));
  }, [data, scope, spotlight, visible]);
  const selected = visible.find((o) => o.id === selectedId) ?? null;

  const dimmedProjectIds = useMemo(() => {
    const out = new Set<string>();
    if (!data || (!filters.start && !filters.end)) return out;
    for (const p of data.projects) if (!inRange(p.properties.in_service, filters.start, filters.end)) out.add(p.properties.id);
    return out;
  }, [data, filters.start, filters.end]);

  // Loading screen: wait for the data and the base map, then Arc flies to his corner and says hello.
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => setMapWaitOver(true), MAP_WAIT_MS);
    return () => clearTimeout(t);
  }, [data]);
  const bootPhase = load.status === "error" ? "error" : data && (mapReady || mapWaitOver || tilesFailed) ? "ready" : "loading";
  const arcRect = useCallback(() => mascot.current?.rect() ?? null, []);
  const overlapCount = data?.overlaps.length ?? 0;
  const onBooted = useCallback(() => {
    setBooting(false);
    if (overlapCount === 0) return;
    setTimeout(
      () =>
        mascot.current?.say(`Hi, I'm Arc. I found ${overlapCount.toLocaleString("en-US")} spots where two utilities' plans meet. Click a row to fly there, or click me for tips.`, "wink"),
      250,
    );
  }, [overlapCount]);

  // What Arc says when clicked, in turn. Built from the data, so the numbers stay true.
  const arcTips = useMemo(() => {
    if (!data?.overlaps.length) return ["Still loading. Give me a second."];
    const n = data.overlaps.length;
    const closest = Math.min(...data.overlaps.map((o) => o.distance_km));
    const timed = data.overlaps.filter((o) => o.time_overlap).length;
    const tips = [
      `${n.toLocaleString("en-US")} pairs of projects from different utilities are within 40 km. The closest are about ${formatKm(closest)} apart.`,
      "Click a row or a line on the map and I'll fly you to that pair.",
      timed
        ? `${timed.toLocaleString("en-US")} of the ${n.toLocaleString("en-US")} pairs also line up in time. Try “Time overlaps only”.`
        : "No pair goes into service within a year of the other yet, so the timing is still open.",
      "Drag me around. I always snap back.",
      "Search a city up top to jump the map there.",
      "Savings are model estimates, so I show a range, not one number.",
      "Press and hold me for a squeeze.",
      "Open a pair to copy a coordination brief you can send to both utilities.",
    ];
    if (selected) {
      tips.unshift(`Pair #${selected.rank} is about ${formatKm(selected.distance_km)} apart. ${TIER_LINES[selected.tier]}`);
    }
    return tips;
  }, [data, selected]);

  const years = useMemo(() => (data ? timeRange(data.projects) : null), [data]);
  // Phones keep framed pairs above the sheet at peek and below the top bar.
  const mapPadding = useMemo(
    () => (phone ? { top: 110, bottom: PEEK_PX + 40, left: 24, right: 24 } : { top: 90, bottom: 60, left: 140, right: 70 }),
    [phone],
  );
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
        if (token !== reactionToken.current) return;
        if (nextVisible.length > 0) void play("idle");
        else mascot.current?.say("Nothing matches those filters. Try widening the dates.", "confused");
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
      if (phone) setSheet("peek");
      map.current?.fitBounds(overlapBounds(o, sides(o, index)));
      // Warn only for a real schedule match or a touching/very close pair. Otherwise just point at it.
      const reaction = o.time_overlap || o.tier <= 2 ? "alert" : "found";
      const timing = o.time_overlap ? " and both go into service within a year" : "";
      mascot.current?.say(`#${o.rank}: about ${formatKm(o.distance_km)} apart${timing}. ${TIER_LINES[o.tier]}`, reaction);
    },
    [data, index, play, phone],
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

  const changeScope = useCallback(
    (next: string) => {
      setScope(next);
      setSelectedId(null);
      const n = data ? data.overlaps.filter((o) => !next || index.get(o.a)?.properties.state === next || index.get(o.b)?.properties.state === next).length : 0;
      mascot.current?.say(next ? `${stateName(next)}: ${n.toLocaleString("en-US")} pairs touch the state.` : "Back to the whole country.", "found");
    },
    [data, index],
  );

  const resetDemo = useCallback(() => {
    setScope("");
    setSpotlight("");
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

  const panel = (
    <SidebarPanel
      menuItems={[
        { label: "Explore overlaps", onSelect: () => { setInfo(null); setSidebarOpen(true); setSheet("full"); } },
        { label: "How it works", onSelect: () => setInfo("how") },
        { label: "Data and methodology", onSelect: () => setInfo("data") },
        { label: "Reset demo", onSelect: resetDemo },
        { label: "Settings", onSelect: () => router.push("/settings") },
      ]}
      dataset={dataset}
      onDatasetChange={changeDataset}
      datasetDisabled={load.status === "loading" && !booting}
      onPlace={onPlace}
      onSearchBusy={onSearchBusy}
      filters={filters}
      onFiltersChange={changeFilters}
      load={load}
      visible={listed}
      inView={listFollows ? { onShowAll: () => map.current?.overview() } : undefined}
      index={index}
      selectedId={selected?.id ?? null}
      onSelect={select}
      onRetry={retry}
      spotlight={spotlight}
      onSpotlight={(u) => {
        setSpotlight(u);
        setSelectedId(null);
        const name = data?.utilities.find((x) => x.code === u)?.name;
        mascot.current?.say(u ? `Spotlight on ${name ?? u}. Only its pairs are showing.` : "Spotlight off. Every utility is back.", "found");
      }}
      utilities={data?.utilities ?? []}
    />
  );

  // On phones the overlays sit above the sheet at peek.
  const aboveSheet = PEEK_PX + 12;
  const selectedPair = selected ? sides(selected, index) : null;

  return (
    <main className="flex h-full bg-bg text-text" aria-busy={booting}>
      {booting && <LoadingScreen phase={bootPhase} overlapCount={overlapCount} target={arcRect} onGone={onBooted} />}
      <section className="relative min-w-0 flex-1" aria-label="Map">
        <MapView
          ref={map}
          projects={mapProjects}
          overlaps={visible}
          selectedId={selected?.id ?? null}
          dimmedProjectIds={dimmedProjectIds}
          colorByUtility={(data?.utilities.length ?? 0) <= 2}
          utilities={data?.utilities ?? []}
          view={view}
          yearCursor={activeYear}
          padding={mapPadding}
          showControls={!phone}
          onSelect={select}
          onProjectClick={onProjectClick}
          onTileError={() => setTilesFailed(true)}
          onReady={() => setMapReady(true)}
          onViewChange={setMapView}
          spotlight={spotlight}
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
              Map tiles could not load. The ranked list still works.
            </p>
          </div>
        )}

        {showYears && years && years[1] > years[0] && (!phone || sheet === "peek") && (
          <div
            className={`pointer-events-none absolute z-10 flex justify-center ${phone ? "inset-x-3" : "bottom-[84px] left-28 right-3"}`}
            style={phone ? { bottom: aboveSheet } : undefined}
          >
            <YearBar range={years} year={yearCursor} onChange={setYearCursor} compact={phone} />
          </div>
        )}

        {!phone && (
          <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-1 whitespace-nowrap rounded-xl border border-line bg-surface/95 p-1 text-xs shadow-md max-lg:left-auto max-lg:right-3 max-lg:translate-x-0">
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
        )}

        <InfoDrawer topic={info} dataset={dataset} onClose={() => setInfo(null)} />

        {/* Top bar. Desktop: scope and legend left, view switch right. Phone: one compact row, legend on demand. */}
        <div
          className={`pointer-events-none absolute z-10 ${phone ? "right-3 top-3" : "right-12 top-2.5"}`}
          style={phone ? { top: "max(12px, env(safe-area-inset-top))" } : undefined}
        >
          <ViewToggle
            view={view}
            onChange={(next) => mapViewChoice.set(next === "flat" ? null : next)}
            years={years}
            utilityCount={data?.utilities.length ?? 0}
            compact={phone}
            yearsOn={yearsOpen}
            onYears={() => {
              setYearsOpen((v) => !v);
              setYearCursor(null);
            }}
          />
        </div>

        <div
          className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-2"
          style={phone ? { top: "max(12px, env(safe-area-inset-top))" } : undefined}
        >
          {data && scopeStates.length > 2 && (
            <ScopePicker scope={scope} states={scopeStates} count={visible.length} onChange={changeScope} compact={phone} />
          )}
          <MapLegend types={projectTypes} utilities={data?.utilities ?? []} illustrative={dataset === "illustrative"} compact={phone} />
        </div>

        <ArcCorner ref={mascot} tips={arcTips} hidden={booting} compact={phone} bottom={phone ? aboveSheet + (showYears && sheet === "peek" ? 76 : 0) : undefined} />

        {!phone && (
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
        )}
      </section>

      {phone ? (
        <BottomSheet
          stop={sheet}
          onStop={setSheet}
          summary={
            <div className="flex min-h-11 items-center justify-between gap-3">
              {selected && selectedPair ? (
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    #{selected.rank} {selectedPair[0].properties.utility} → {selectedPair[1].properties.utility}
                    <span className="ml-2 font-mono text-xs font-normal text-muted">{formatKm(selected.distance_km)}</span>
                  </p>
                  <p className="truncate text-xs text-muted">{selectedPair[0].properties.name}</p>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {data ? `${listed.length.toLocaleString("en-US")} ${listFollows ? "in view" : "overlaps"}` : "Loading overlaps…"}
                    {scope && <span className="font-normal text-muted"> in {stateName(scope)}</span>}
                  </p>
                  <p className="text-xs text-muted">{dataset === "illustrative" ? "Illustrative data. Drag up for the list." : "Sperry sample. Drag up for the list."}</p>
                </div>
              )}
              {selected ? (
                <button type="button" onClick={() => select(null)} className="min-h-11 shrink-0 rounded-full border border-line px-4 text-xs font-medium">
                  Close
                </button>
              ) : (
                <button type="button" onClick={() => map.current?.overview()} className="min-h-11 shrink-0 rounded-full border border-line px-4 text-xs font-medium">
                  Overview
                </button>
              )}
            </div>
          }
        >
          {panel}
        </BottomSheet>
      ) : (
        <aside
          id="sidebar"
          aria-label="Overlaps"
          inert={!sidebarOpen}
          onTransitionEnd={() => map.current?.resize()}
          className={`flex h-full shrink-0 flex-col overflow-hidden border-l border-line bg-bg transition-[width] duration-300 ${
            sidebarOpen ? "w-[42%] min-w-[330px] max-w-[520px] lg:w-[30%] lg:min-w-[360px]" : "w-0 min-w-0 border-l-0"
          }`}
        >
          {panel}
        </aside>
      )}
    </main>
  );
}

