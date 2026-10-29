"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { ExpressionSpecification } from "maplibre-gl";
import Map, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { LngLat, Overlap, Project, ProjectType, UtilityInfo } from "@/lib/data";
import { CAP, projectLevels, ribbons, stitches, type MapView3D } from "./map3d";
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
  utilities: UtilityInfo[];
  // Flat map, or a tilted 3D view with height for time or for utility.
  view: MapView3D;
  onSelect(id: string | null): void;
  onProjectClick(projectId: string): void;
  onTileError?(): void;
  // The base map style has loaded, so the map is ready to show.
  onReady?(): void;
}

const INTERACTIVE = ["overlap-lines-hit", "project-markers", "project-lines-hit"];
const INTERACTIVE_3D = [...INTERACTIVE, "ribbons-coarse", "ribbons-fine", "stitches-coarse", "stitches-fine"];

// 3D views: the camera tilt, and how tall the full height is at each zoom (metres), so ribbons stay
// in proportion from the whole country down to one town.
const PITCH_3D = 55;
const BEARING_3D = -18;
const HEIGHT_STOPS: [number, number][] = [
  [3, 450_000],
  [5, 130_000],
  [7, 32_000],
  [9, 8_000],
  [11, 2_000],
  [14, 300],
];
const height = (share: unknown) => ["interpolate", ["linear"], ["zoom"], ...HEIGHT_STOPS.flatMap(([z, m]) => [z, ["*", share, m]])];
// Ribbons and stitches are wider when zoomed out, so they still read at country scale.
const WIDTH_SPLIT_ZOOM = 6.5;
const RIBBON_HALF = { coarse: 4_000, fine: 450 };
const STITCH_HALF = { coarse: 3_000, fine: 320 };

export default function MapView({
  ref,
  projects,
  overlaps,
  selectedId,
  dimmedProjectIds,
  colorByUtility,
  utilities,
  view,
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

  // Features only change with the data and the date filter. Opening a pair changes paint expressions
  // (SIDE, DIMMED, SELECTED below), not the data, so it stays fast with thousands of projects.
  const projectFeatures = useMemo(() => {
    const markers: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    for (const p of projects) {
      const id = p.properties.id;
      const properties = { id, utility: p.properties.utility, type: p.properties.type, dimmed: dimmedProjectIds.has(id) };
      markers.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: markerPoint(p) } });
      if (p.geometry.type === "LineString") lines.push({ type: "Feature", properties, geometry: p.geometry });
    }
    return {
      markers: { type: "FeatureCollection", features: markers } as GeoJSON.FeatureCollection,
      lines: { type: "FeatureCollection", features: lines } as GeoJSON.FeatureCollection,
    };
  }, [projects, dimmedProjectIds]);

  const overlapLines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: overlaps.map((o) => ({
        type: "Feature",
        properties: { id: o.id, tier: o.tier },
        geometry: { type: "LineString", coordinates: o.closest_points },
      })),
    }),
    [overlaps],
  );

  const big = projects.length >= BIG_DATASET;
  const is3d = view !== "flat";

  // Tilt the camera into 3D and back.
  useEffect(() => {
    if (!loaded) return;
    map.current?.easeTo({ pitch: is3d ? PITCH_3D : 0, bearing: is3d ? BEARING_3D : 0, duration: 900 });
  }, [is3d, loaded]);

  const levels = useMemo(() => projectLevels(projects, utilities, view === "utility" ? "utility" : "time"), [projects, utilities, view]);
  const solids = useMemo(() => {
    if (!is3d) return null;
    const props = (p: Project) => ({ id: p.properties.id, utility: p.properties.utility, dimmed: dimmedProjectIds.has(p.properties.id) });
    return {
      ribbonsCoarse: ribbons(projects, levels, RIBBON_HALF.coarse, props),
      ribbonsFine: ribbons(projects, levels, RIBBON_HALF.fine, props),
      stitchesCoarse: stitches(overlaps, levels, STITCH_HALF.coarse),
      stitchesFine: stitches(overlaps, levels, STITCH_HALF.fine),
    };
  }, [is3d, projects, overlaps, levels, dimmedProjectIds]);

  if (!colors) return <div className="h-full w-full bg-bg" />;

  // Per-feature state as expressions: which side of the open pair a project is on (-1 for neither),
  // whether it is dimmed, and whether an overlap is the open one.
  const sideIds = Object.entries(sideOf);
  const SIDE = (sideIds.length ? ["match", ["get", "id"], ...sideIds.flatMap(([id, side]) => [id, side]), -1] : ["number", -1]) as ExpressionSpecification;
  const DIMMED = (hasSelection ? ["==", SIDE, -1] : ["get", "dimmed"]) as ExpressionSpecification;
  const SELECTED: ExpressionSpecification = ["==", ["get", "id"], selectedId ?? ""];

  const tierColor = ["match", ["get", "tier"], 1, colors["--tier-1"], 2, colors["--tier-2"], 3, colors["--tier-3"], colors["--tier-4"]];
  // Sides of the open pair first, then by utility (sample) or one shared colour (many utilities).
  const projectColor = [
    "match",
    SIDE,
    0,
    colors["--utility-b"],
    1,
    colors["--utility-a"],
    colorByUtility ? ["match", ["get", "utility"], "DESC", colors["--utility-a"], colors["--utility-b"]] : colors["--muted"],
  ];
  // Ribbons: the open pair's sides in their colours, everything else in the normal project colour, dimmed ones muted.
  const ribbonColor = ["case", ["all", DIMMED, ["==", SIDE, -1]], colors["--muted"], projectColor];
  const pairOpacity = (others: number) => ["case", SELECTED, 1, others];

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
      interactiveLayerIds={is3d ? INTERACTIVE_3D : INTERACTIVE}
      cursor={hovering ? "pointer" : "grab"}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(e) => {
        const f = e.features?.[0];
        if (!f) return;
        const layer = f.layer.id;
        const props = f.properties as Record<string, unknown>;
        if (layer === "overlap-lines-hit" || layer.startsWith("stitches")) onSelect(props.id as string);
        else if (layer === "project-markers" || layer === "project-lines-hit" || layer.startsWith("ribbons")) onProjectClick(props.id as string);
      }}
      attributionControl={{ compact: false }}
    >
      <NavigationControl position="top-right" showCompass={is3d} visualizePitch />

      <Source id="project-lines" type="geojson" data={projectFeatures.lines}>
        <Layer
          id="project-lines"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 7, 2.5, 10, 3.5],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-color": projectColor as any,
            "line-opacity": ["case", DIMMED, 0.18, ["==", SIDE, -1], big ? 0.55 : 0.9, 1],
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
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", SELECTED, 9, big ? 3 : 6], 7, ["case", SELECTED, 11, 6]],
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
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", SELECTED, 6, big ? 1.5 : 3], 7, ["case", SELECTED, 7, 3]],
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

      {solids && (
        <>
          <Source id="ribbons-coarse" type="geojson" data={solids.ribbonsCoarse}>
            <SolidLayers id="coarse" source="ribbons-coarse" kind="ribbon" maxzoom={WIDTH_SPLIT_ZOOM} color={ribbonColor} />
          </Source>
          <Source id="ribbons-fine" type="geojson" data={solids.ribbonsFine}>
            <SolidLayers id="fine" source="ribbons-fine" kind="ribbon" minzoom={WIDTH_SPLIT_ZOOM} color={ribbonColor} />
          </Source>
          <Source id="stitches-coarse" type="geojson" data={solids.stitchesCoarse}>
            <SolidLayers id="coarse" source="stitches-coarse" kind="stitch" maxzoom={WIDTH_SPLIT_ZOOM} color={tierColor} />
          </Source>
          <Source id="stitches-fine" type="geojson" data={solids.stitchesFine}>
            <SolidLayers id="fine" source="stitches-fine" kind="stitch" minzoom={WIDTH_SPLIT_ZOOM} color={tierColor} />
          </Source>
        </>
      )}

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
              ["case", ["==", SIDE, -1], big ? 0.32 : 0.9, 1],
              7,
              ["case", ["==", SIDE, -1], big ? 0.6 : 0.9, 1.1],
              10,
              ["case", ["==", SIDE, -1], big ? 0.75 : 1, 1.2],
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // Open pair on top, dimmed ones underneath.
            "symbol-sort-key": ["case", ["!=", SIDE, -1], 2, DIMMED, 0, 1],
          }}
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "icon-color": projectColor as any,
            "icon-halo-color": colors["--surface"],
            "icon-halo-width": 1.5,
            // In 3D the ribbons carry the projects; the markers stay on the ground as faint shadows.
            "icon-opacity": ["case", DIMMED, is3d ? 0.15 : 0.3, ["==", SIDE, -1], is3d ? 0.35 : 1, 1],
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

// The 3D solids. Ribbons: a see-through curtain from the ground (lines only) and a solid slab on top.
// Stitches: one slab from the lower project's height to the higher one's, in the tier colour.
// Layers inside a wrapper component do not get the source from <Source>, so it is passed in.
function SolidLayers({
  id,
  source,
  kind,
  minzoom,
  maxzoom,
  color,
}: {
  id: string;
  source: string;
  kind: "ribbon" | "stitch";
  minzoom?: number;
  maxzoom?: number;
  color: unknown;
}) {
  const zoom = { ...(minzoom !== undefined && { minzoom }), ...(maxzoom !== undefined && { maxzoom }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = color as any;
  if (kind === "stitch") {
    return (
      <Layer
        id={`stitches-${id}`}
        source={source}
        type="fill-extrusion"
        {...zoom}
        paint={{
          "fill-extrusion-color": c,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-extrusion-base": height(["get", "lo"]) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-extrusion-height": height(["get", "hi"]) as any,
          "fill-extrusion-opacity": 0.9,
        }}
      />
    );
  }
  return (
    <>
      <Layer
        id={`curtains-${id}`}
        source={source}
        type="fill-extrusion"
        filter={["get", "line"]}
        {...zoom}
        paint={{
          "fill-extrusion-color": c,
          "fill-extrusion-base": 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-extrusion-height": height(["-", ["get", "top"], CAP]) as any,
          "fill-extrusion-opacity": 0.18,
          "fill-extrusion-vertical-gradient": true,
        }}
      />
      <Layer
        id={`ribbons-${id}`}
        source={source}
        type="fill-extrusion"
        {...zoom}
        paint={{
          "fill-extrusion-color": c,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-extrusion-base": height(["-", ["get", "top"], CAP]) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-extrusion-height": height(["get", "top"]) as any,
          "fill-extrusion-opacity": 0.95,
        }}
      />
    </>
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
