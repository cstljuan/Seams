import { describe, expect, it } from "vitest";
import type { Overlap, Project } from "@/lib/data";
import { narrate } from "./narrate";

const project = (id: string, utility: string, state: string, start: string | null, in_service: string, type: Project["properties"]["type"] = "line"): Project => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-84, 33] },
  properties: {
    id,
    utility,
    utility_name: utility,
    state,
    name: id,
    type,
    voltage_kv: 115,
    in_service,
    start,
    endpoints: [],
    geometry_quality: "generated",
    confidence: 1,
    source: { doc: "test", page: null, url: null },
  },
});

const overlap = (o: Partial<Overlap>): Overlap =>
  ({ id: "o", rank: 3, a: "a", b: "b", distance_km: 2.5, tier: 3, time_gap_days: 900, time_overlap: false, closest_points: [[0, 0], [0, 0]], approximate: true, cost: null, ...o }) as Overlap;

describe("narrate", () => {
  it("says the builds overlap, in months, when both have start dates", () => {
    const pair: [Project, Project] = [project("a", "AAA", "FL", "2027-01-01", "2028-01-01"), project("b", "BBB", "FL", "2027-07-01", "2029-01-01")];
    const line = narrate(overlap({ time_overlap: true, time_gap_days: 365 }), pair);
    expect(line).toMatch(/builds overlap by 6 months/);
    expect(line).toMatch(/share a laydown yard/);
  });

  it("names a state line when the two are in different states", () => {
    const pair: [Project, Project] = [project("a", "AAA", "GA", null, "2027-01-01"), project("b", "BBB", "SC", null, "2032-01-01")];
    expect(narrate(overlap({ time_gap_days: 1826 }), pair)).toMatch(/across the GA and SC line, and they go into service about 5 years apart/);
  });

  it("flags touching pairs as urgent and never invents a distance for them", () => {
    const pair: [Project, Project] = [project("a", "AAA", "TX", null, "2027-01-01"), project("b", "BBB", "TX", null, "2027-03-01", "substation")];
    const line = narrate(overlap({ tier: 1, distance_km: 0, time_overlap: true, time_gap_days: 59 }), pair);
    expect(line).toMatch(/^#3: They touch or cross/);
    expect(line).toMatch(/Worth a call this week/);
    expect(line).toMatch(/a line and a substation/);
  });

  it("is the same every time for the same pair", () => {
    const pair: [Project, Project] = [project("a", "AAA", "FL", null, "2027-01-01"), project("b", "BBB", "FL", null, "2027-06-01")];
    expect(narrate(overlap({}), pair)).toBe(narrate(overlap({}), pair));
  });
});
