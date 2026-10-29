"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import Map, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { LngLat, Overlap, Project, ProjectType } from "@/lib/data";
import { SHAPES, shapeImage } from "./mapShapes";
import { cleanText, projectCoords, sideVar } from "./overlaps";
import { useColorScheme } from "./useColorScheme";
import { useThemeColors } from "./useThemeColors";

const STYLE_URLS = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
// Only used until the data arrives; then the camera fits the projects.
const START_VIEW = { longitude: -96, latitude: 38.5, zoom: 3.4 };
// Leaves room for the legend (top left) and Arc (bottom left).
const FIT_PADDING = { top: 90, bottom: 60, left: 140, right: 70 };

// With this many projects or more, markers start small when zoomed out so the map stays readable.
const BIG_DATASET = 150;

const SHAPE_IDS = Object.keys(SHAPES) as ProjectType[];
const shapeId = (t: ProjectType) => `seams-shape-${t}`;

export interface MapHandle {
  fitBounds(bounds: [LngLat, LngLat]): void;
  overview(): void;
  flyTo(center: LngLat, zoom?: number): void;
  resize(): void;
}

interface Props {
  ref?: Ref<MapHandle>;
  projects: Project[];
  overlaps: Overlap[];
  selectedId: string | null;
  dimmedProjectIds: Set<string>;
  // Colour projects by utility when there are only two (the Sperry sample). Otherwise they share one colour
  // and only the two sides of the open pair get their own.
  colorByUtility: boolean;
  onSelect(id: string | null): void;
  onProjectClick(projectId: string): void;
  onTileError?(): void;
  // The base map style has loaded, so the map is ready to show.
  onReady?(): void;
}

const INTERACTIVE = ["overlap-lines-hit", "project-markers", "project-lines-hit"];

export default function MapView({
  ref,
  projects,
  overlaps,
  selectedId,
  dimmedProjectIds,
  colorByUtility,
  onSelect,
  onProjectClick,
  onTileError,
  onReady,
}: Props) {
  const map = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const tileErrorSent = useRef(false);

  const dataBounds = useMemo<[LngLat, LngLat] | null>(() => {
    const pts = projects.flatMap(projectCoords);
    if (!pts.length) return null;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [lng, lat] of pts) {
      w = Math.min(w, lng);
      e = Math.max(e, lng);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
    return [
      [w, s],
      [e, n],
    ];
  }, [projects]);

  const overview = useCallback(
    (duration = 1200) => {
      if (dataBounds) map.current?.fitBounds(dataBounds, { padding: FIT_PADDING, maxZoom: 9, duration });
    },
    [dataBounds],
  );

  // Frame the project region whenever a new dataset arrives and the map is ready.
  const framedFor = useRef<[LngLat, LngLat] | null>(null);
  useEffect(() => {
    if (!loaded || !dataBounds || framedFor.current === dataBounds) return;
    const first = framedFor.current === null;
    framedFor.current = dataBounds;
    overview(first ? 0 : 1200);
  }, [loaded, dataBounds, overview]);

  const colors = useThemeColors();
  const scheme = useColorScheme();
  const [hovering, setHovering] = useState(false);

  useImperativeHandle(ref, () => ({
    fitBounds(bounds) {
      map.current?.fitBounds(bounds, { padding: { ...FIT_PADDING, top: 110 }, maxZoom: 10, duration: 1400 });
    },
    overview() {
      overview();
    },
    flyTo(center, zoom = 9) {
      map.current?.flyTo({ center, zoom, duration: 1400 });
    },
    resize() {
      map.current?.resize();
    },
  }));

  // Marker shapes live in the map style, so add them again after every style load (theme switches reload it).
  const addShapes = useCallback(() => {
    const m = map.current?.getMap();
    if (!m) return;
    for (const t of SHAPE_IDS) if (!m.hasImage(shapeId(t))) m.addImage(shapeId(t), shapeImage(t), { sdf: true, pixelRatio: 2 });
  }, []);

  const selected = overlaps.find((o) => o.id === selectedId) ?? null;
  const hasSelection = selected !== null;
  // Side 0 or 1 for the two projects in the open pair, matching the list (higher utility code first).
  const sideOf = useMemo(() => {
    const out: Record<string, 0 | 1> = {};
    if (!selected) return out;
    const a = projects.find((p) => p.properties.id === selected.a);
    const b = projects.find((p) => p.properties.id === selected.b);
    const aFirst = !a || !b || a.properties.utility > b.properties.utility;
    out[selected.a] = aFirst ? 0 : 1;
    out[selected.b] = aFirst ? 1 : 0;
    return out;
  }, [selected, projects]);

  const projectFeatures = useMemo(() => {
    const markers: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    for (const p of projects) {
      const id = p.properties.id;
      const side: number = sideOf[id] ?? -1;
      const properties = {
        id,
        utility: p.properties.utility,
        type: p.properties.type,
        side,
        dimmed: side === -1 && (hasSelection || dimmedProjectIds.has(id)),
      };
      markers.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: markerPoint(p) } });
      if (p.geometry.type === "LineString") lines.push({ type: "Feature", properties, geometry: p.geometry });
    }
    return {
      markers: { type: "FeatureCollection", features: markers } as GeoJSON.FeatureCollection,
      lines: { type: "FeatureCollection", features: lines } as GeoJSON.FeatureCollection,
    };
  }, [projects, sideOf, hasSelection, dimmedProjectIds]);

  const overlapLines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: overlaps.map((o) => ({
        type: "Feature",
        properties: { id: o.id, tier: o.tier, selected: o.id === selectedId },
        geometry: { type: "LineString", coordinates: o.closest_points },
      })),
    }),
    [overlaps, selectedId],
  );

  const big = projects.length >= BIG_DATASET;

  if (!colors) return <div className="h-full w-full bg-bg" />;

  const tierColor = ["match", ["get", "tier"], 1, colors["--tier-1"], 2, colors["--tier-2"], 3, colors["--tier-3"], colors["--tier-4"]];
  // Sides of the open pair first, then by utility (sample) or one shared colour (many utilities).
  const projectColor = [
    "match",
    ["get", "side"],
    0,
    colors["--utility-b"],
    1,
    colors["--utility-a"],
    colorByUtility ? ["match", ["get", "utility"], "DESC", colors["--utility-a"], colors["--utility-b"]] : colors["--muted"],
  ];
  const pairOpacity = (others: number) => ["case", ["get", "selected"], 1, others];

  return (
    <Map
      ref={map}
      initialViewState={START_VIEW}
      onLoad={() => {
        addShapes();
        setLoaded(true);
        onReady?.();
      }}
      onStyleData={addShapes}
      onError={(e) => {
        // Tile or style failures: tell the app once so the list can carry on alone.
        if (tileErrorSent.current) return;
        const msg = String((e as { error?: Error }).error?.message ?? "");
        if (/fetch|tile|style|Failed|NetworkError|40\d|50\d/i.test(msg)) {
          tileErrorSent.current = true;
          onTileError?.();
        }
      }}
      mapStyle={STYLE_URLS[scheme]}
      style={{ width: "100%", height: "100%" }}
      interactiveLayerIds={INTERACTIVE}
      cursor={hovering ? "pointer" : "grab"}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(e) => {
        const f = e.features?.[0];
        if (!f) return;
        const layer = f.layer.id;
        const props = f.properties as Record<string, unknown>;
        if (layer === "overlap-lines-hit") onSelect(props.id as string);
        else if (layer === "project-markers" || layer === "project-lines-hit") onProjectClick(props.id as string);
      }}
      attributionControl={{ compact: false }}
    >
      <NavigationControl position="top-right" showCompass={false} />

      <Source id="project-lines" type="geojson" data={projectFeatures.lines}>
        <Layer
          id="project-lines"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 7, 2.5, 10, 3.5],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-color": projectColor as any,
            "line-opacity": ["case", ["get", "dimmed"], 0.18, ["==", ["get", "side"], -1], big ? 0.55 : 0.9, 1],
          }}
        />
        <Layer id="project-lines-hit" type="line" paint={{ "line-color": colors["--text"], "line-width": 10, "line-opacity": 0 }} />
      </Source>

      <Source id="overlap-lines" type="geojson" data={overlapLines}>
        <Layer
          id="overlap-lines-casing"
          type="line"
          layout={{ "line-cap": "round" }}
          paint={{
            "line-color": colors["--surface"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "selected"], 9, big ? 3 : 6], 7, ["case", ["get", "selected"], 11, 6]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-opacity": pairOpacity(hasSelection ? 0.4 : 0.9) as any,
          }}
        />
        <Layer
          id="overlap-lines"
          type="line"
          layout={{ "line-cap": "round" }}
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-color": tierColor as any,
            // Thinner when zoomed out on the big dataset, so 1,500 seams stay readable.
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "selected"], 6, big ? 1.5 : 3], 7, ["case", ["get", "selected"], 7, 3]],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-opacity": pairOpacity(hasSelection ? 0.35 : 0.9) as any,
          }}
        />
        {/* Wide invisible line so thin lines are easy to click. */}
        <Layer
          id="overlap-lines-hit"
          type="line"
          paint={{ "line-color": colors["--text"], "line-width": 16, "line-opacity": 0 }}
        />
      </Source>

      <Source id="project-markers" type="geojson" data={projectFeatures.markers}>
        <Layer
          id="project-markers"
          type="symbol"
          layout={{
            "icon-image": ["concat", "seams-shape-", ["get", "type"]],
            // Small when zoomed out on the big dataset; the few sample projects stay full size.
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              ["case", ["==", ["get", "side"], -1], big ? 0.32 : 0.9, 1],
              7,
              ["case", ["==", ["get", "side"], -1], big ? 0.6 : 0.9, 1.1],
              10,
              ["case", ["==", ["get", "side"], -1], big ? 0.75 : 1, 1.2],
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // Open pair on top, dimmed ones underneath.
            "symbol-sort-key": ["case", ["!=", ["get", "side"], -1], 2, ["get", "dimmed"], 0, 1],
          }}
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "icon-color": projectColor as any,
            "icon-halo-color": colors["--surface"],
            "icon-halo-width": 1.5,
            "icon-opacity": ["case", ["get", "dimmed"], 0.3, 1],
          }}
        />
      </Source>

      {/* Labels for the two projects in the open pair. Only two, so plain DOM markers are fine. */}
      {selected &&
        projects
          .filter((p) => sideOf[p.properties.id] !== undefined)
          .map((p) => {
            const side = sideOf[p.properties.id];
            const [lng, lat] = markerPoint(p);
            return (
              <Marker key={p.properties.id} longitude={lng} latitude={lat} anchor={side === 0 ? "bottom" : "top"} style={{ zIndex: 2 }}>
                <div
                  className={`pointer-events-none max-w-56 rounded-md ${side === 0 ? "mb-3" : "mt-3"} border border-line bg-surface px-2 py-1 text-[11px] leading-tight text-text shadow-md`}
                  style={{ width: "max-content" }}
                >
                  <span className="font-semibold" style={{ color: sideVar(side) }}>
                    {p.properties.utility}
                  </span>{" "}
                  <span className="line-clamp-2">{cleanText(p.properties.name)}</span>
                </div>
              </Marker>
            );
          })}
    </Map>
  );
}

// Point projects sit on their point; line projects get a marker at the middle vertex.
function markerPoint(p: Project): LngLat {
  if (p.geometry.type === "Point") return p.geometry.coordinates;
  const c = p.geometry.coordinates;
  return c[Math.floor(c.length / 2)];
}

// Shape by project type, colour by utility (via currentColor). Used by the legend.
export function MarkerShape({ type, size = 16 }: { type: ProjectType; size?: number }) {
  const common = { fill: "currentColor", stroke: "var(--surface)", strokeWidth: 2 };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ overflow: "visible" }}>
      {type === "substation" && <circle cx="8" cy="8" r="6.5" {...common} />}
      {type === "line" && <rect x="2" y="2" width="12" height="12" rx="2" {...common} />}
      {type === "rebuild" && <path d="M8 0.8 15.2 8 8 15.2 0.8 8Z" {...common} strokeLinejoin="round" />}
      {type === "reconductor" && <path d="M8 1 15 14.5H1Z" {...common} strokeLinejoin="round" />}
      {type === "other" && <circle cx="8" cy="8" r="5.5" fill="var(--surface)" stroke="currentColor" strokeWidth={3} />}
    </svg>
  );
}
