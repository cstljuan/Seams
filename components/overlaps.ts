// Pure helpers for the overlap list and details. No React here, so they are easy to test.
import type { LngLat, Overlap, Project, Utility } from "@/lib/data";

export const TIER_LABELS: Record<Overlap["tier"], string> = {
  1: "Touching or crossing: must coordinate outage timing and crossing structures",
  2: "Under 1.6 km: can share land (right-of-way, access roads, permits)",
  3: "Under 8 km: can share site logistics (laydown yards, deliveries)",
  4: "Under 40 km: can share crews and equipment",
};

export interface Filters {
  start: string; // YYYY-MM-DD or ""
  end: string;
  timeOnly: boolean;
}

export const EMPTY_FILTERS: Filters = { start: "", end: "", timeOnly: false };

export function hasFilters(f: Filters): boolean {
  return f.start !== "" || f.end !== "" || f.timeOnly;
}

// ISO dates compare correctly as strings.
export function inRange(date: string, start: string, end: string): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export type ProjectIndex = Map<string, Project>;

export function indexProjects(projects: Project[]): ProjectIndex {
  return new Map(projects.map((p) => [p.properties.id, p]));
}

// The two sides of an overlap, GPC first to match the "GPC -> DESC" row label.
export function sides(o: Overlap, index: ProjectIndex): [Project, Project] | null {
  const a = index.get(o.a);
  const b = index.get(o.b);
  if (!a || !b) return null;
  return a.properties.utility === "GPC" ? [a, b] : [b, a];
}

// An overlap stays when at least one of its projects is in service inside the date range.
export function filterOverlaps(overlaps: Overlap[], index: ProjectIndex, f: Filters): Overlap[] {
  return overlaps
    .filter((o) => !f.timeOnly || o.time_overlap)
    .filter((o) => {
      if (!f.start && !f.end) return true;
      const pair = sides(o, index);
      return !!pair && pair.some((p) => inRange(p.properties.in_service, f.start, f.end));
    })
    .sort((x, y) => x.rank - y.rank);
}

export function accuracy(pair: [Project, Project]): "Exact" | "Centroid" {
  return pair.every((p) => p.properties.geometry_quality === "osm_line") ? "Exact" : "Centroid";
}

export function formatKm(km: number): string {
  return `${km.toFixed(2)} km`;
}

export function formatDays(days: number): string {
  return `${days.toLocaleString("en-US")} ${days === 1 ? "day" : "days"}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// Source text sometimes has HTML entities, e.g. "&amp;".
export function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function utilityVar(u: Utility): string {
  return u === "DESC" ? "var(--utility-a)" : "var(--utility-b)";
}

export function projectCoords(p: Project): LngLat[] {
  return p.geometry.type === "Point" ? [p.geometry.coordinates] : p.geometry.coordinates;
}

// [[west, south], [east, north]] around both projects and the closest points.
export function overlapBounds(o: Overlap, pair: [Project, Project] | null): [LngLat, LngLat] {
  const pts: LngLat[] = [...o.closest_points, ...(pair ? pair.flatMap(projectCoords) : [])];
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

// Unique sources for the pair, keeping order.
export function sources(pair: [Project, Project]): Project["properties"]["source"][] {
  const seen = new Set<string>();
  const out: Project["properties"]["source"][] = [];
  for (const p of pair) {
    const s = p.properties.source;
    const key = `${s.doc}|${s.page}|${s.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}
