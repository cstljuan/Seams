import { describe, expect, it } from "vitest";
import type { Overlap } from "@/lib/data";
import { hexOf, hexPolygon, hexbin } from "./hexbins";

const overlap = (id: string, at: [number, number], tier: 1 | 2 | 3 | 4): Overlap => ({
  id,
  rank: 1,
  a: "A",
  b: "B",
  distance_km: 1,
  tier,
  time_gap_days: 0,
  time_overlap: false,
  closest_points: [at, at],
  approximate: true,
  cost: null,
});

describe("hexbin", () => {
  it("puts nearby overlaps in one hexagon and far ones apart", () => {
    const out = hexbin(
      [overlap("1", [-84.39, 33.75], 3), overlap("2", [-84.4, 33.76], 1), overlap("3", [-122.4, 37.77], 4)],
      50_000,
    );
    expect(out.features).toHaveLength(2);
    const atlanta = out.features.find((f) => f.properties.count === 2)!;
    expect(atlanta.properties.tier).toBe(1);
    expect(atlanta.properties.share).toBe(1);
  });

  it("returns a closed ring that contains its own centre", () => {
    const at: [number, number] = [-80.19, 25.76];
    const ring = hexPolygon(hexOf(at, 40_000), 40_000);
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(at[0]).toBeGreaterThan(Math.min(...lngs));
    expect(at[0]).toBeLessThan(Math.max(...lngs));
    expect(at[1]).toBeGreaterThan(Math.min(...lats));
    expect(at[1]).toBeLessThan(Math.max(...lats));
  });
});
