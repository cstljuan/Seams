// The one place the UI gets project and overlap data from.
// Shapes follow docs/data-contract.md.
import projectsFixture from "@/data/fixtures/projects.geojson";
import overlapsFixture from "@/data/fixtures/overlaps.json";
import { DEFAULT_DATASET, type Dataset } from "./dataset";

// A utility's short code, e.g. "DESC", "GPC", or a code from the illustrative dataset.
export type Utility = string;
export type ProjectType = "line" | "substation" | "rebuild" | "reconductor" | "other";
// "generated" means the geometry was made up for the illustrative dataset.
export type GeometryQuality = "osm_line" | "substation_midpoint" | "single_substation" | "generated";
export type LngLat = [number, number];

export interface ProjectProperties {
  id: string;
  utility: Utility;
  utility_name: string;
  state: string;
  name: string;
  type: ProjectType;
  voltage_kv: number | null;
  in_service: string;
  start: string | null;
  endpoints: { name: string; coordinates: LngLat | null }[];
  geometry_quality: GeometryQuality;
  confidence: number;
  source: { doc: string; page: number | null; url: string | null };
  // True for projects in the illustrative dataset that are not real plans.
  synthetic?: boolean;
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

export interface UtilityInfo {
  code: Utility;
  name: string;
  states: string[];
  // True when the utility is invented for the illustrative dataset.
  fictional: boolean;
}

export interface SeamsData {
  dataset: Dataset;
  projects: Project[];
  overlaps: Overlap[];
  utilities: UtilityInfo[];
}

// The real Sperry sample has two utilities. Their names come from the sample package.
export const SAMPLE_UTILITIES: UtilityInfo[] = [
  { code: "DESC", name: "Dominion Energy South Carolina", states: ["SC"], fictional: false },
  { code: "GPC", name: "Georgia Power", states: ["GA"], fictional: false },
];

// Where the illustrative dataset lives. Static files, so MongoDB Atlas keeps serving the sample.
export const ILLUSTRATIVE_BASE = "/data/illustrative";

// "api" reads /api/projects and /api/overlaps (Atlas, then local JSON). Same shapes as the fixtures.
const SOURCE: "fixtures" | "api" = "api";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

type Loaded = Omit<SeamsData, "dataset">;

async function loadFixtures(): Promise<Loaded> {
  return {
    projects: (projectsFixture as unknown as { features: Project[] }).features,
    overlaps: overlapsFixture as unknown as Overlap[],
    utilities: SAMPLE_UTILITIES,
  };
}

async function loadApi(): Promise<Loaded> {
  const [projects, overlaps] = await Promise.all([
    getJson<{ features: Project[] }>("/api/projects"),
    getJson<Overlap[]>("/api/overlaps"),
  ]);
  return { projects: projects.features, overlaps, utilities: SAMPLE_UTILITIES };
}

async function loadIllustrative(): Promise<Loaded> {
  const [projects, overlaps, utilities] = await Promise.all([
    getJson<{ features: Project[] }>(`${ILLUSTRATIVE_BASE}/projects.geojson`),
    getJson<Overlap[]>(`${ILLUSTRATIVE_BASE}/overlaps.json`),
    getJson<UtilityInfo[]>(`${ILLUSTRATIVE_BASE}/utilities.json`),
  ]);
  return { projects: projects.features, overlaps, utilities };
}

export async function loadData(dataset: Dataset = DEFAULT_DATASET): Promise<SeamsData> {
  const data =
    dataset === "illustrative" ? await loadIllustrative() : SOURCE === "api" ? await loadApi() : await loadFixtures();
  return { ...data, dataset, overlaps: [...data.overlaps].sort((x, y) => x.rank - y.rank) };
}
