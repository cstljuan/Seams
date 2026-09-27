// The one place the UI gets project and overlap data from.
// Shapes follow docs/data-contract.md.
import projectsFixture from "@/data/fixtures/projects.geojson";
import overlapsFixture from "@/data/fixtures/overlaps.json";

export type Utility = "DESC" | "GPC";
export type ProjectType = "line" | "substation" | "rebuild" | "reconductor" | "other";
export type GeometryQuality = "osm_line" | "substation_midpoint" | "single_substation";
export type LngLat = [number, number];

export interface ProjectProperties {
  id: string;
  utility: Utility;
  utility_name: string;
  state: "SC" | "GA";
  name: string;
  type: ProjectType;
  voltage_kv: number | null;
  in_service: string;
  start: string | null;
  endpoints: { name: string; coordinates: LngLat | null }[];
  geometry_quality: GeometryQuality;
  confidence: number;
  source: { doc: string; page: number | null; url: string | null };
}

export interface Project {
  type: "Feature";
  geometry: { type: "Point"; coordinates: LngLat } | { type: "LineString"; coordinates: LngLat[] };
  properties: ProjectProperties;
}

export interface Cost {
  p10: number;
  p50: number;
  p90: number;
  currency: "USD";
  trucks_saved: number;
  co2_t: number;
}

export interface Overlap {
  id: string;
  rank: number;
  a: string;
  b: string;
  distance_km: number;
  tier: 1 | 2 | 3 | 4;
  time_gap_days: number;
  time_overlap: boolean;
  closest_points: [LngLat, LngLat];
  approximate: boolean;
  cost: Cost | null;
}

export interface SeamsData {
  projects: Project[];
  overlaps: Overlap[];
}

// "api" reads /api/projects and /api/overlaps (Atlas, then local JSON). Same shapes as the fixtures.
const SOURCE: "fixtures" | "api" = "api";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadFixtures(): Promise<SeamsData> {
  return {
    projects: (projectsFixture as unknown as { features: Project[] }).features,
    overlaps: overlapsFixture as unknown as Overlap[],
  };
}

async function loadApi(): Promise<SeamsData> {
  const [projects, overlaps] = await Promise.all([
    getJson<{ features: Project[] }>("/api/projects"),
    getJson<Overlap[]>("/api/overlaps"),
  ]);
  return { projects: projects.features, overlaps };
}

export async function loadData(): Promise<SeamsData> {
  const data = SOURCE === "api" ? await loadApi() : await loadFixtures();
  return { ...data, overlaps: [...data.overlaps].sort((x, y) => x.rank - y.rank) };
}
