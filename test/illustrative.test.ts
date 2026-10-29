import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Overlap, Project, UtilityInfo } from "@/lib/data";

const dir = path.join(process.cwd(), "public/data/illustrative");
const read = <T>(file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as T;
const projects = read<{ features: Project[] }>("projects.geojson").features;
const overlaps = read<Overlap[]>("overlaps.json");
const utilities = read<UtilityInfo[]>("utilities.json");
const byId = new Map(projects.map((p) => [p.properties.id, p]));

describe("illustrative dataset", () => {
  it("is big enough to need hexagons", () => {
    expect(projects.length).toBeGreaterThan(500);
    expect(overlaps.length).toBeGreaterThan(500);
  });

  it("only pairs projects from two different utilities, within 40 km", () => {
    for (const o of overlaps) {
      const a = byId.get(o.a);
      const b = byId.get(o.b);
      expect(a && b).toBeTruthy();
      expect(a!.properties.utility).not.toBe(b!.properties.utility);
      expect(o.distance_km).toBeLessThan(40);
      expect(o.cost && o.cost.p10 <= o.cost.p50 && o.cost.p50 <= o.cost.p90).toBe(true);
    }
  });

  it("is ranked 1 to n with unique ids", () => {
    expect(overlaps.map((o) => o.rank)).toEqual(overlaps.map((_, i) => i + 1));
    expect(new Set(overlaps.map((o) => o.id)).size).toBe(overlaps.length);
  });

  it("marks every made-up project, and keeps DESC and GPC as the real sample", () => {
    for (const p of projects) {
      const real = p.properties.utility === "DESC" || p.properties.utility === "GPC";
      expect(Boolean(p.properties.synthetic)).toBe(!real);
      if (!real) expect(p.properties.geometry_quality).toBe("generated");
    }
    expect(projects.filter((p) => !p.properties.synthetic)).toHaveLength(10);
  });

  it("lists every utility that has projects, with only DESC and GPC marked real", () => {
    const codes = new Set(utilities.map((u) => u.code));
    for (const p of projects) expect(codes.has(p.properties.utility)).toBe(true);
    expect(utilities.filter((u) => !u.fictional).map((u) => u.code).sort()).toEqual(["DESC", "GPC"]);
  });
});
