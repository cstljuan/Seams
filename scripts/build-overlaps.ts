import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildOverlaps } from "../lib/engine/build";
import type { Project } from "../lib/data";

interface ProjectCollection {
  features: Project[];
}

async function readProjects(file: string): Promise<ProjectCollection> {
  return JSON.parse(await readFile(file, "utf8")) as ProjectCollection;
}

async function main() {
  const root = process.cwd();
  let projects: Project[];
  try {
    projects = (await readProjects(path.join(root, "data/projects.geojson"))).features;
    console.log("Using data/projects.geojson");
  } catch {
    projects = (await readProjects(path.join(root, "data/fixtures/projects.geojson"))).features;
    console.log("Using data/fixtures/projects.geojson");
  }

  const ranked = buildOverlaps(projects);
  const outFile = path.join(root, "data/overlaps.json");
  await writeFile(outFile, `${JSON.stringify(ranked, null, 2)}\n`, "utf8");
  console.log(`Wrote ${ranked.length} overlaps to data/overlaps.json`);
  console.table(
    ranked.map(({ rank, a, b, distance_km, tier: overlapTier, time_overlap, cost }) => ({
      rank,
      a,
      b,
      distance_km,
      tier: overlapTier,
      time_overlap,
      cost_p10_usd: cost?.p10,
      cost_p50_usd: cost?.p50,
      cost_p90_usd: cost?.p90,
    })),
  );
}

main().catch((error: unknown) => {
  console.error("Could not build overlaps:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
