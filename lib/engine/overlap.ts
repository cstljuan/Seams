import { distance, point, nearestPointOnLine } from "@turf/turf";
import type { Feature, LineString, Point } from "geojson";
import type { LngLat, Overlap, Project } from "@/lib/data";

type SupportedFeature = Feature<Point | LineString>;

function lineCandidates(line: Feature<LineString>, coordinates: number[][]) {
  return coordinates.map((coordinates) => {
    const from = point(coordinates);
    const nearest = nearestPointOnLine(line, from, { units: "kilometers" });
    const to = nearest.geometry.coordinates as LngLat;
    return {
      km: distance(from, point(to), { units: "kilometers" }),
      points: [coordinates as LngLat, to] as [LngLat, LngLat],
    };
  });
}

export function closestDistanceKm(
  a: SupportedFeature,
  b: SupportedFeature,
): { km: number; points: [LngLat, LngLat] } {
  const candidates = [];
  if (a.geometry.type === "Point" && b.geometry.type === "Point") {
    const first = a.geometry.coordinates as LngLat;
    const second = b.geometry.coordinates as LngLat;
    return {
      km: distance(point(first), point(second), { units: "kilometers" }),
      points: [first, second],
    };
  }

  if (a.geometry.type === "Point" && b.geometry.type === "LineString") {
    candidates.push(...lineCandidates(b as Feature<LineString>, [a.geometry.coordinates]));
  } else if (a.geometry.type === "LineString" && b.geometry.type === "Point") {
    candidates.push(
      ...lineCandidates(a as Feature<LineString>, [b.geometry.coordinates]).map(({ km, points }) => ({
        km,
        points: [points[1], points[0]] as [LngLat, LngLat],
      })),
    );
  } else if (a.geometry.type === "LineString" && b.geometry.type === "LineString") {
    candidates.push(...lineCandidates(b as Feature<LineString>, a.geometry.coordinates));
    candidates.push(
      ...lineCandidates(a as Feature<LineString>, b.geometry.coordinates).map(({ km, points }) => ({
        km,
        points: [points[1], points[0]] as [LngLat, LngLat],
      })),
    );
  }

  if (!candidates.length) throw new Error("Unsupported geometry pair");
  return candidates.reduce((best, candidate) => (candidate.km < best.km ? candidate : best));
}

export function tier(km: number): 1 | 2 | 3 | 4 | null {
  if (km <= 0.05) return 1;
  if (km < 1.6) return 2;
  if (km < 8) return 3;
  if (km < 40) return 4;
  return null;
}

function dateValue(value: string): number | null {
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}

export function timeGapDays(a: Project, b: Project): number {
  const first = dateValue(a.properties.in_service);
  const second = dateValue(b.properties.in_service);
  if (first === null || second === null) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(first - second) / 86_400_000);
}

export function timeOverlap(a: Project, b: Project): boolean {
  const aEnd = dateValue(a.properties.in_service);
  const bEnd = dateValue(b.properties.in_service);
  const aStart = a.properties.start ? dateValue(a.properties.start) : null;
  const bStart = b.properties.start ? dateValue(b.properties.start) : null;

  if (aStart !== null && bStart !== null && aEnd !== null && bEnd !== null) {
    return aStart <= bEnd && bStart <= aEnd;
  }
  return timeGapDays(a, b) <= 365;
}

export function rankOverlaps<T extends Pick<Overlap, "tier" | "distance_km" | "time_overlap">>(
  list: T[],
): (T & { rank: number })[] {
  return [...list]
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.distance_km - b.distance_km ||
        Number(b.time_overlap) - Number(a.time_overlap),
    )
    .map((overlap, index) => ({ ...overlap, rank: index + 1 }));
}
