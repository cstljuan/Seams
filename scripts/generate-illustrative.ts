// Builds the illustrative dataset: real US towns, made-up utility plans.
// Output goes to public/data/illustrative/ as static files, so MongoDB Atlas keeps serving the Sperry sample.
// The same seed always gives the same data. Run: npm run generate:illustrative
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildOverlaps } from "../lib/engine/build";
import type { LngLat, Project, ProjectType, UtilityInfo } from "../lib/data";

const SEED = "seams-illustrative-2026-10-29";
// Scales every utility's project count.
const SCALE = 3.6;
const SOURCE_DOC = "Seams illustrative dataset (generated). Not a real utility plan.";
const KM_PER_DEG = 111.32;

// --- Random numbers, seeded so the output is stable ---
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = rng(SEED);
const between = (lo: number, hi: number) => lo + random() * (hi - lo);
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
function weighted<T>(list: T[], weight: (item: T) => number): T {
  const total = list.reduce((sum, item) => sum + weight(item), 0);
  let draw = random() * total;
  for (const item of list) {
    draw -= weight(item);
    if (draw <= 0) return item;
  }
  return list[list.length - 1];
}

// --- Real places ---
interface City {
  name: string;
  state: string;
  population: number;
  at: LngLat;
}

// Lower 48 towns of 1,000 people or more, from GeoNames (scripts/data/README.md).
async function readCities(): Promise<City[]> {
  const csv = await readFile(path.join(process.cwd(), "scripts/data/us-towns-geonames.csv"), "utf8");
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .map(([name, state, population, lat, lon]) => ({
      name,
      state,
      population: Number(population),
      at: [Number(lon), Number(lat)] as LngLat,
    }));
}

// --- Invented utilities. Names are made up; any match with a real company is a coincidence. ---
interface UtilitySpec {
  code: string;
  name: string;
  states: string[];
  kind: "transmission" | "local";
  count: number;
  // Optional latitude limits, to split a big state between two utilities.
  latMin?: number;
  latMax?: number;
}

const UTILITIES: UtilitySpec[] = [
  { code: "WST", name: "Westspan Transmission", kind: "transmission", count: 28, states: ["WA", "OR", "ID", "CA", "NV", "AZ", "UT"] },
  { code: "RKT", name: "Rockline Transmission", kind: "transmission", count: 22, states: ["MT", "WY", "CO", "NM", "UT", "ND", "SD", "NE", "KS"] },
  { code: "MIP", name: "Midline Interstate Power", kind: "transmission", count: 26, states: ["TX", "OK", "KS", "MO", "AR", "LA", "IA", "MN"] },
  { code: "IST", name: "Inland Seas Transmission", kind: "transmission", count: 24, states: ["IL", "IN", "OH", "MI", "WI", "MN", "PA"] },
  { code: "SBT", name: "Seaboard Span Transmission", kind: "transmission", count: 24, states: ["NY", "NJ", "PA", "MD", "DE", "VA", "NC", "MA", "CT", "RI", "NH", "VT", "ME"] },
  { code: "SXT", name: "Southern Crossing Transmission", kind: "transmission", count: 24, states: ["FL", "AL", "MS", "TN", "KY", "GA", "SC", "NC"] },
  { code: "CDL", name: "Cedarline Power", kind: "local", count: 34, states: ["WA", "OR", "ID"] },
  { code: "RBE", name: "Redwood Basin Electric", kind: "local", count: 34, states: ["CA"], latMin: 35.5 },
  { code: "PVP", name: "Paloma Valley Power", kind: "local", count: 40, states: ["CA"], latMax: 35.5 },
  { code: "RME", name: "Redmesa Energy", kind: "local", count: 34, states: ["AZ", "NM", "NV", "UT"] },
  { code: "HPE", name: "Highpass Electric Cooperative", kind: "local", count: 30, states: ["CO", "WY", "MT"] },
  { code: "LMP", name: "Lone Mesquite Power", kind: "local", count: 42, states: ["TX"] },
  { code: "SWP", name: "Switchgrass Power Cooperative", kind: "local", count: 30, states: ["KS", "NE", "OK", "ND", "SD", "IA"] },
  { code: "NWD", name: "Northwood Electric", kind: "local", count: 30, states: ["MN", "WI"] },
  { code: "LSG", name: "Lakeshore Grid", kind: "local", count: 38, states: ["MI", "OH", "IN", "IL"] },
  { code: "RPA", name: "Riverbend Power Authority", kind: "local", count: 36, states: ["TN", "KY", "AR", "MS", "AL", "LA", "MO"] },
  { code: "MGV", name: "Mangrove Electric", kind: "local", count: 38, states: ["FL"] },
  { code: "LLF", name: "Longleaf Power", kind: "local", count: 34, states: ["NC", "VA", "SC", "GA"] },
  { code: "IBE", name: "Ironbridge Electric", kind: "local", count: 34, states: ["NY", "NJ", "PA"] },
  { code: "GCP", name: "Granite Coast Power", kind: "local", count: 30, states: ["MA", "CT", "RI", "NH", "VT", "ME"] },
  { code: "LHE", name: "Laurel Highlands Electric", kind: "local", count: 28, states: ["MD", "DE", "WV", "VA"] },
  { code: "SPC", name: "Sunpine Cooperative", kind: "local", count: 30, states: ["FL", "GA", "AL"], latMin: 28.5 },
  { code: "BLE", name: "Bayou Line Electric", kind: "local", count: 30, states: ["LA", "MS"] },
  { code: "CRP", name: "Canyon Rim Power", kind: "local", count: 28, states: ["CO", "UT", "AZ", "NM"] },
  { code: "SGP", name: "Sagebrush Power", kind: "local", count: 26, states: ["NV", "ID", "OR", "WY"] },
  { code: "PHE", name: "Prairie Hollow Electric", kind: "local", count: 28, states: ["ND", "SD", "MN", "NE"] },
  { code: "HCP", name: "Hollow Creek Power", kind: "local", count: 30, states: ["MO", "AR", "OK", "KS"] },
  { code: "SME", name: "Saltmarsh Electric", kind: "local", count: 28, states: ["SC", "GA", "NC", "FL"] },
  { code: "RWP", name: "Ridgeway Power", kind: "local", count: 30, states: ["KY", "TN", "WV", "OH"] },
  { code: "PWE", name: "Pinewood Electric", kind: "local", count: 24, states: ["ME", "NH", "VT", "NY"] },
  { code: "GPP", name: "Gulf Prairie Power", kind: "local", count: 32, states: ["TX", "LA"], latMax: 31.5 },
];

// --- Geometry helpers ---
function offset([lng, lat]: LngLat, km: number, bearing: number): LngLat {
  const dLat = (km * Math.cos(bearing)) / KM_PER_DEG;
  const dLng = (km * Math.sin(bearing)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [round(lng + dLng), round(lat + dLat)];
}
// Four decimals is about 11 m, plenty for made-up plans, and keeps the files small.
const round = (n: number) => Number(n.toFixed(4));
function kmBetween(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * KM_PER_DEG;
  const dLng = (b[0] - a[0]) * KM_PER_DEG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

// A line from a to b that wanders a little, like a real route around terrain.
function route(a: LngLat, b: LngLat): LngLat[] {
  const steps = 3 + Math.floor(random() * 4);
  const length = kmBetween(a, b);
  const bearing = Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]);
  const out: LngLat[] = [[round(a[0]), round(a[1])]];
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const base: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    out.push(offset(base, between(-0.12, 0.12) * length, bearing + Math.PI / 2));
  }
  out.push([round(b[0]), round(b[1])]);
  return out;
}

// --- Names and dates ---
const SUBSTATION_NAMES = ["North", "South", "East", "West", "Riverside", "Junction", "Industrial Park", "Ridge", "Airport", "Lakeview", "Mill Creek", "Hilltop", "Canal", "Rail Yard", "Prairie"];
const OTHER_PROJECTS = ["grid battery", "switching station", "solar tie-in", "capacitor bank", "control house rebuild"];

function isoDate(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

function schedule(kind: UtilitySpec["kind"]): { start: string; in_service: string } {
  const year = 2026 + Math.floor(random() * 8);
  const month = Math.floor(random() * 12);
  const months = kind === "transmission" ? Math.round(between(14, 48)) : Math.round(between(6, 30));
  return { start: isoDate(year, month, 1 + Math.floor(random() * 28)), in_service: isoDate(year, month + months, 1 + Math.floor(random() * 28)) };
}

const LOCAL_KV = [69, 115, 138, 161];
const TRANSMISSION_KV = [230, 345, 500];

// --- Projects ---
function makeProjects(spec: UtilitySpec, cities: City[]): Project[] {
  const pool = cities.filter(
    (c) => spec.states.includes(c.state) && (spec.latMin === undefined || c.at[1] >= spec.latMin) && (spec.latMax === undefined || c.at[1] < spec.latMax),
  );
  if (pool.length < 2) throw new Error(`Not enough towns for ${spec.code}`);
  // Spread work across states, not just the ones with the most towns, then favour bigger towns.
  const byState = new Map<string, City[]>();
  for (const c of pool) byState.set(c.state, [...(byState.get(c.state) ?? []), c]);
  const states = [...byState.keys()];
  // Towns are weighted only lightly by size, so rural areas fill in too, not just the big metros.
  const town = () => weighted(byState.get(weighted(states, (s) => Math.pow(byState.get(s)!.length, 0.45)))!, (c) => Math.pow(c.population, 0.2));

  const transmission = spec.kind === "transmission";
  const out: Project[] = [];
  for (let n = 1; n <= Math.round(spec.count * SCALE); n += 1) {
    const type: ProjectType = transmission
      ? weighted<ProjectType>(["line", "rebuild", "substation", "reconductor"], (t) => ({ line: 5, rebuild: 2, substation: 2, reconductor: 1 })[t as "line"])
      : weighted<ProjectType>(["substation", "line", "rebuild", "reconductor", "other"], (t) => ({ substation: 4, line: 3, rebuild: 2, reconductor: 1.5, other: 0.7 })[t as "line"]);
    const kv = pick(transmission ? TRANSMISSION_KV : LOCAL_KV);
    const from = town();
    let geometry: Project["geometry"];
    let name: string;
    let endpoints: Project["properties"]["endpoints"];

    if (type === "substation" || type === "other") {
      const at = offset(from.at, between(1.5, 14), between(0, Math.PI * 2));
      geometry = { type: "Point", coordinates: at };
      name =
        type === "substation"
          ? `${from.name} ${pick(SUBSTATION_NAMES)} ${kv} kV substation ${pick(["expansion", "upgrade", "new build"])}`
          : `${from.name} ${pick(OTHER_PROJECTS)}`;
      endpoints = [{ name: `${from.name} ${pick(SUBSTATION_NAMES)}`, coordinates: at }];
    } else {
      const [lo, hi] = transmission ? [40, 220] : [8, 80];
      const near = pool.filter((c) => c !== from && kmBetween(c.at, from.at) >= lo && kmBetween(c.at, from.at) <= hi);
      const to = near.length ? weighted(near, (c) => Math.pow(c.population, 0.3)) : null;
      const end = to ? to.at : offset(from.at, between(lo, Math.min(hi, lo * 2)), between(0, Math.PI * 2));
      const start = offset(from.at, between(0.5, 5), between(0, Math.PI * 2));
      const finish = offset(end, between(0.5, 5), between(0, Math.PI * 2));
      geometry = { type: "LineString", coordinates: route(start, finish) };
      const toName = to ? to.name : `${from.name} ${pick(SUBSTATION_NAMES)}`;
      const work = { line: "line", rebuild: "line rebuild", reconductor: "reconductor" }[type as "line"];
      name = `${from.name} to ${toName} ${kv} kV ${work}`;
      endpoints = [
        { name: `${from.name} substation`, coordinates: start },
        { name: `${toName} substation`, coordinates: finish },
      ];
    }

    out.push({
      type: "Feature",
      geometry,
      properties: {
        id: `${spec.code}_${n}`,
        utility: spec.code,
        utility_name: spec.name,
        state: from.state,
        name,
        type,
        voltage_kv: kv,
        ...schedule(spec.kind),
        endpoints,
        geometry_quality: "generated",
        confidence: Number(between(0.5, 0.95).toFixed(2)),
        source: { doc: SOURCE_DOC, page: null, url: null },
        synthetic: true,
      },
    });
  }
  return out;
}

async function main() {
  const root = process.cwd();
  const cities = await readCities();
  // The real Sperry sample stays in, under its real utility names, so DESC and GPC show up too.
  const sample = JSON.parse(await readFile(path.join(root, "data/fixtures/projects.geojson"), "utf8")) as { features: Project[] };
  const projects = [...sample.features, ...UTILITIES.flatMap((u) => makeProjects(u, cities))];
  const overlaps = buildOverlaps(projects).map((o) => ({
    ...o,
    closest_points: o.closest_points.map(([lng, lat]) => [round(lng), round(lat)]) as [LngLat, LngLat],
  }));

  const utilities: UtilityInfo[] = [
    { code: "DESC", name: "Dominion Energy South Carolina", states: ["SC"], fictional: false },
    { code: "GPC", name: "Georgia Power", states: ["GA"], fictional: false },
    ...UTILITIES.map((u) => ({ code: u.code, name: u.name, states: u.states, fictional: true })),
  ];

  const outDir = path.join(root, "public/data/illustrative");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "projects.geojson"), JSON.stringify({ type: "FeatureCollection", features: projects }));
  await writeFile(path.join(outDir, "overlaps.json"), JSON.stringify(overlaps));
  await writeFile(path.join(outDir, "utilities.json"), JSON.stringify(utilities, null, 2));

  const tiers = [1, 2, 3, 4].map((t) => overlaps.filter((o) => o.tier === t).length);
  console.log(`${projects.length} projects, ${utilities.length} utilities, ${overlaps.length} overlaps`);
  console.log(`By tier: ${tiers.join(" / ")}. Time overlaps: ${overlaps.filter((o) => o.time_overlap).length}`);
}

main().catch((error: unknown) => {
  console.error("Could not generate the illustrative dataset:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
