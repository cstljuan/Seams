import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateCost } from "../lib/engine/cost";
import { closestDistanceKm, rankOverlaps, tier, timeGapDays, timeOverlap } from "../lib/engine/overlap";
import type { Overlap, Project } from "../lib/data";

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

  const desc = projects.filter((project) => project.properties.utility === "DESC");
  const gpc = projects.filter((project) => project.properties.utility === "GPC");
  const overlaps: Overlap[] = [];

  for (const a of desc) {
    for (const b of gpc) {
      const closest = closestDistanceKm(a, b);
      const overlapTier = tier(closest.km);
      if (overlapTier === null) continue;

      const gap = timeGapDays(a, b);
      overlaps.push({
        id: `OVL_${a.properties.id}_${b.properties.id}`,
        rank: 0,
        a: a.properties.id,
        b: b.properties.id,
        distance_km: Number(closest.km.toFixed(2)),
        tier: overlapTier,
        time_gap_days: gap,
        time_overlap: timeOverlap(a, b),
        closest_points: closest.points,
        approximate:
          a.properties.geometry_quality !== "osm_line" ||
          b.properties.geometry_quality !== "osm_line",
        cost: estimateCost({ a, b, tier: overlapTier, distanceKm: closest.km }),
      });
    }
  }

  const ranked = rankOverlaps(overlaps) as Overlap[];
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
