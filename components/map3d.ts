// Geometry for the 3D map views, after the Tokyo Last Train Atlas idea: height carries a second dimension.
// "time": each project floats at a height set by its in-service date (later is higher).
// "utility": each utility gets its own floor.
// Projects become thin ribbons (fill-extrusion slabs) with a see-through curtain down to the ground,
// and the open overlap gets a stitch between the two heights, so a long time gap is a tall stitch.
// Every other seam stays a tier-coloured line on the ground.
// Pure functions; MapView turns heights into metres with a zoom-based scale.
import type { LngLat, Overlap, Project, UtilityInfo } from "@/lib/data";

export type MapView3D = "flat" | "time" | "utility";

const R = 6_378_137;
// Lowest ribbon still sits a little above the ground, so curtains and stitches show.
const FLOOR = 0.08;
// Ribbon thickness, as a share of the full height scale.
export const CAP = 0.014;


function toMercator([lng, lat]: LngLat): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  return [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))];
}
function toLngLat([x, y]: [number, number]): LngLat {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

// A square around a point, `half` Mercator metres from centre to edge.
function square(at: LngLat, half: number): LngLat[] {
  const [x, y] = toMercator(at);
  return [
    toLngLat([x - half, y - half]),
    toLngLat([x + half, y - half]),
    toLngLat([x + half, y + half]),
    toLngLat([x - half, y + half]),
    toLngLat([x - half, y - half]),
  ];
}

// A thin rectangle along one segment, `half` Mercator metres either side.
function band(a: LngLat, b: LngLat, half: number): LngLat[] | null {
  const [ax, ay] = toMercator(a);
  const [bx, by] = toMercator(b);
  const len = Math.hypot(bx - ax, by - ay);
  if (len < half) return null;
  const nx = (-(by - ay) / len) * half;
  const ny = ((bx - ax) / len) * half;
  // Overlap the ends a little so joints between segments do not show gaps.
  const ex = ((bx - ax) / len) * half;
  const ey = ((by - ay) / len) * half;
  return [
    toLngLat([ax - ex + nx, ay - ey + ny]),
    toLngLat([bx + ex + nx, by + ey + ny]),
    toLngLat([bx + ex - nx, by + ey - ny]),
    toLngLat([ax - ex - nx, ay - ey - ny]),
    toLngLat([ax - ex + nx, ay - ey + ny]),
  ];
}

// Footprint for a path: one band per segment, or a square for a point or a very short path.
export function footprint(coords: LngLat[], half: number): GeoJSON.MultiPolygon {
  const polys: LngLat[][][] = [];
  for (let i = 0; i + 1 < coords.length; i += 1) {
    const ring = band(coords[i], coords[i + 1], half);
    if (ring) polys.push([ring]);
  }
  if (!polys.length) polys.push([square(coords[0], half)]);
  return { type: "MultiPolygon", coordinates: polys };
}

const yearValue = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

// Each project's height from 0 to 1 (before FLOOR), for the chosen view.
export function projectLevels(projects: Project[], utilities: UtilityInfo[], view: MapView3D): Map<string, number> {
  const out = new Map<string, number>();
  if (view === "utility") {
    const codes = [...new Set([...utilities.map((u) => u.code), ...projects.map((p) => p.properties.utility)])].sort();
    const step = codes.length > 1 ? 1 / (codes.length - 1) : 0;
    for (const p of projects) out.set(p.properties.id, codes.indexOf(p.properties.utility) * step);
    return out;
  }
  const times = projects.map((p) => yearValue(p.properties.in_service)).filter((t): t is number => t !== null);
  const lo = Math.min(...times);
  const span = Math.max(1, Math.max(...times) - lo);
  for (const p of projects) {
    const t = yearValue(p.properties.in_service);
    out.set(p.properties.id, t === null ? 0 : (t - lo) / span);
  }
  return out;
}

// Turns a 0..1 level into the share of the height scale where the ribbon's top sits.
export const top = (level: number) => FLOOR + (1 - FLOOR) * level;

export function projectYears(projects: Project[]): Map<string, number> {
  return new Map(projects.map((p) => [p.properties.id, yearOf(p)]));
}

// The years at the bottom and top of the time view, for the caption.
export function timeRange(projects: Project[]): [number, number] | null {
  const years = projects.map((p) => Number(p.properties.in_service.slice(0, 4))).filter(Number.isFinite);
  return years.length ? [Math.min(...years), Math.max(...years)] : null;
}

const yearOf = (p: Project) => Number(p.properties.in_service.slice(0, 4)) || 0;

export function ribbons(
  projects: Project[],
  levels: Map<string, number>,
  half: number,
  props: (p: Project) => Record<string, unknown>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: projects.map((p) => {
      const coords = p.geometry.type === "Point" ? [p.geometry.coordinates] : p.geometry.coordinates;
      const t = top(levels.get(p.properties.id) ?? 0);
      return {
        type: "Feature",
        properties: { ...props(p), top: t, year: yearOf(p), line: p.geometry.type === "LineString" },
        geometry: footprint(coords, half),
      };
    }),
  };
}

export function stitches(
  overlaps: Overlap[],
  levels: Map<string, number>,
  half: number,
  years?: Map<string, number>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: overlaps.map((o) => {
      const a = top(levels.get(o.a) ?? 0);
      const b = top(levels.get(o.b) ?? 0);
      return {
        type: "Feature",
        // year: when the later of the two is in service, so the year bar can show the seam once both exist.
        properties: {
          id: o.id,
          tier: o.tier,
          lo: Math.min(a, b) - CAP,
          hi: Math.max(a, b),
          year: Math.max(years?.get(o.a) ?? 0, years?.get(o.b) ?? 0),
        },
        // One thin stitch at the middle of the gap, not a wall along it.
        geometry: footprint([midpoint(o.closest_points)], half),
      };
    }),
  };
}

const midpoint = ([a, b]: [LngLat, LngLat]): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
