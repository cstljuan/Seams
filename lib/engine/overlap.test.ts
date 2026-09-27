import { describe, expect, it } from "vitest";
import projectsData from "@/data/fixtures/projects.geojson";
import overlapsData from "@/data/fixtures/overlaps.json";
import type { Project } from "@/lib/data";
import { closestDistanceKm, tier } from "./overlap";

const projects = (projectsData as unknown as { features: Project[] }).features;
const overlaps = overlapsData as {
  a: string;
  b: string;
  sperry_distance_km: number;
  tier: 1 | 2 | 3 | 4;
}[];
const byId = new Map(projects.map((project) => [project.properties.id, project]));

describe("fixture overlap geometry", () => {
  it("matches fixture distances and tiers", () => {
    for (const overlap of overlaps) {
      const a = byId.get(overlap.a);
      const b = byId.get(overlap.b);
      expect(a, `missing project ${overlap.a}`).toBeDefined();
      expect(b, `missing project ${overlap.b}`).toBeDefined();
      if (!a || !b) continue;

      const measured = closestDistanceKm(a, b);
      expect(Math.abs(measured.km - overlap.sperry_distance_km)).toBeLessThanOrEqual(0.05);
      expect(tier(measured.km)).toBe(overlap.tier);
    }
  });

  it("keeps the distant DESC_4 and GPC_4 pair out of range", () => {
    const desc = byId.get("DESC_4");
    const gpc = byId.get("GPC_4");
    expect(desc).toBeDefined();
    expect(gpc).toBeDefined();
    if (!desc || !gpc) return;

    expect(closestDistanceKm(desc, gpc).km).toBeGreaterThan(40);
    expect(tier(closestDistanceKm(desc, gpc).km)).toBeNull();
  });
});
