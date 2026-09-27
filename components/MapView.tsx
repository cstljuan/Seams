"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import Map, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { LngLat, Overlap, Project, ProjectType } from "@/lib/data";
import { cleanText, projectCoords, utilityVar } from "./overlaps";
import { useColorScheme } from "./useColorScheme";
import { useThemeColors } from "./useThemeColors";

const STYLE_URLS = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
// Only used until the data arrives; then the camera fits the projects.
const START_VIEW = { longitude: -81.6, latitude: 32.6, zoom: 6.3 };
// Leaves room for the legend (top left) and Arc (bottom left).
const FIT_PADDING = { top: 90, bottom: 60, left: 140, right: 70 };

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
  onSelect(id: string | null): void;
  onProjectClick(projectId: string): void;
  onTileError?(): void;
}

export default function MapView({ ref, projects, overlaps, selectedId, dimmedProjectIds, onSelect, onProjectClick, onTileError }: Props) {
  const map = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const tileErrorSent = useRef(false);

  const dataBounds = useMemo<[LngLat, LngLat] | null>(() => {
    const pts = projects.flatMap(projectCoords);
    if (!pts.length) return null;
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
  }, [projects]);

  const overview = useCallback(
    (duration = 1200) => {
      if (dataBounds) map.current?.fitBounds(dataBounds, { padding: FIT_PADDING, maxZoom: 9, duration });
    },
    [dataBounds],
  );

  // Frame the real project region once both the map and the data are ready.
  const framed = useRef(false);
  useEffect(() => {
    if (!loaded || !dataBounds || framed.current) return;
    framed.current = true;
    overview(0);
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

  const selected = overlaps.find((o) => o.id === selectedId) ?? null;
  const selectedProjects = new Set(selected ? [selected.a, selected.b] : []);

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

  const projectLines = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: projects
        .filter((p) => p.geometry.type === "LineString")
        .map((p) => ({ type: "Feature", properties: { utility: p.properties.utility }, geometry: p.geometry })),
    }),
    [projects],
  );

  const tierColor = colors
    ? ["match", ["get", "tier"], 1, colors["--tier-1"], 2, colors["--tier-2"], 3, colors["--tier-3"], colors["--tier-4"]]
    : null;
  const hasSelection = selectedId !== null;

  return (
    <Map
      ref={map}
      initialViewState={START_VIEW}
      onLoad={() => setLoaded(true)}
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
      interactiveLayerIds={["overlap-lines-hit"]}
      cursor={hovering ? "pointer" : "grab"}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={(e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelect(id);
      }}
      attributionControl={{ compact: false }}
    >
      <NavigationControl position="top-right" showCompass={false} />

      {colors && (
        <Source id="project-lines" type="geojson" data={projectLines}>
          <Layer
            id="project-lines"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-width": 3,
              "line-opacity": hasSelection ? 0.35 : 0.9,
              "line-color": ["match", ["get", "utility"], "DESC", colors["--utility-a"], colors["--utility-b"]],
            }}
          />
        </Source>
      )}

      {colors && tierColor && (
        <Source id="overlap-lines" type="geojson" data={overlapLines}>
          <Layer
            id="overlap-lines-casing"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": colors["--surface"],
              "line-width": ["case", ["get", "selected"], 11, 6],
              "line-opacity": ["case", ["get", "selected"], 1, hasSelection ? 0.4 : 0.9],
            }}
          />
          <Layer
            id="overlap-lines"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              "line-color": tierColor as any,
              "line-width": ["case", ["get", "selected"], 7, 3],
              "line-opacity": ["case", ["get", "selected"], 1, hasSelection ? 0.35 : 0.9],
            }}
          />
          {/* Wide invisible line so thin lines are easy to click. */}
          <Layer id="overlap-lines-hit" type="line" paint={{ "line-color": colors["--text"], "line-width": 16, "line-opacity": 0 }} />
        </Source>
      )}

      {projects.map((p) => {
        const [lng, lat] = markerPoint(p);
        const isSelected = selectedProjects.has(p.properties.id);
        const dimmed = (dimmedProjectIds.has(p.properties.id) || (hasSelection && !isSelected)) && !isSelected;
        return (
          <Marker
            key={p.properties.id}
            longitude={lng}
            latitude={lat}
            anchor="center"
            style={{ zIndex: isSelected ? 2 : 1 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onProjectClick(p.properties.id);
            }}
          >
            <div
              title={`${p.properties.utility}: ${cleanText(p.properties.name)}`}
              className="cursor-pointer transition-[opacity,transform] duration-200"
              style={{
                opacity: dimmed ? 0.3 : 1,
                transform: isSelected ? "scale(1.5)" : undefined,
                color: utilityVar(p.properties.utility),
              }}
            >
              <MarkerShape type={p.properties.type} />
            </div>
            {isSelected && (
              <div
                className={`pointer-events-none absolute left-1/2 max-w-56 -translate-x-1/2 rounded-md ${
                  p.properties.utility === "GPC" ? "bottom-full mb-2" : "top-full mt-2"
                } border border-line bg-surface px-2 py-1 text-[11px] leading-tight text-text shadow-md`}
                style={{ width: "max-content" }}
              >
                <span className="font-semibold" style={{ color: utilityVar(p.properties.utility) }}>
                  {p.properties.utility}
                </span>{" "}
                <span className="line-clamp-2">{cleanText(p.properties.name)}</span>
              </div>
            )}
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

// Shape by project type, colour by utility (via currentColor).
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
