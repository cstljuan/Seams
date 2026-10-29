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

describe("stations and colours", () => {
  it("puts a station at both ends of a line and one on a point", async () => {
    const { stations, projectLevels } = await import("./map3d");
    const line = { ...project("l", "AAA", "2030-01-01"), geometry: { type: "LineString", coordinates: [[-84, 33], [-83.9, 33], [-83.8, 33.1]] } } as Project;
    const point = project("p", "BBB", "2031-01-01");
    const out = stations([line, point], projectLevels([line, point], [], "time"), 300);
    expect(out.features).toHaveLength(3);
    expect(out.features[0].properties!.year).toBe(2030);
  });

  it("gives utilities stable colour slots that cycle", async () => {
    const { colourSlots, LINE_COLOURS } = await import("./map3d");
    const many = Array.from({ length: LINE_COLOURS + 2 }, (_, i) => project(`p${i}`, `U${String(i).padStart(2, "0")}`, "2030-01-01"));
    const slots = colourSlots(many, []);
    expect(slots.get("U00")).toBe(0);
    expect(slots.get(`U${LINE_COLOURS}`)).toBe(0);
    expect(slots.get("U01")).toBe(1);
  });
});
