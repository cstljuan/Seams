import { describe, expect, it } from "vitest";
import type { Overlap, Project } from "@/lib/data";
import { footprint, projectLevels, stitches, top } from "./map3d";

const project = (id: string, utility: string, in_service: string): Project => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-84, 33] },
  properties: {
    id,
    utility,
    utility_name: utility,
    state: "GA",
    name: id,
    type: "substation",
    voltage_kv: 115,
    in_service,
    start: null,
    endpoints: [],
    geometry_quality: "generated",
    confidence: 1,
    source: { doc: "test", page: null, url: null },
  },
});

describe("3D map geometry", () => {
  const projects = [project("a", "AAA", "2026-01-01"), project("b", "BBB", "2031-01-01"), project("c", "CCC", "2036-01-01")];

  it("puts the earliest project lowest and the latest highest in the time view", () => {
    const levels = projectLevels(projects, [], "time");
    expect(levels.get("a")).toBe(0);
    expect(levels.get("c")).toBe(1);
    expect(levels.get("b")).toBeCloseTo(0.5, 2);
  });

  it("gives each utility its own floor in the utility view", () => {
    const levels = projectLevels(projects, [], "utility");
    expect([levels.get("a"), levels.get("b"), levels.get("c")]).toEqual([0, 0.5, 1]);
  });

  it("makes a stitch that spans the two projects' heights", () => {
    const levels = projectLevels(projects, [], "time");
    const o = { id: "o", a: "a", b: "c", tier: 2, closest_points: [[-84, 33], [-84.01, 33.01]] } as unknown as Overlap;
    const f = stitches([o], levels, 500).features[0].properties!;
    expect(f.hi).toBe(top(1));
    expect(f.lo).toBeLessThan(top(0));
  });

  it("builds one band per segment, or a square for a point", () => {
    expect(footprint([[-84, 33], [-83.9, 33], [-83.9, 33.1]], 500).coordinates).toHaveLength(2);
    const point = footprint([[-84, 33]], 500).coordinates;
    expect(point).toHaveLength(1);
    expect(point[0][0]).toHaveLength(5);
  });
});
