import { describe, expect, it } from "vitest";
import projectsFc from "@/data/fixtures/projects.geojson";
import overlapsJson from "@/data/fixtures/overlaps.json";
import type { Overlap, Project } from "@/lib/data";
import {
  EMPTY_FILTERS,
  accuracy,
  cleanText,
  filterOverlaps,
  formatKm,
  indexProjects,
  overlapBounds,
  sides,
} from "./overlaps";
import { matchPlaces } from "./places";

const projects = (projectsFc as unknown as { features: Project[] }).features;
const overlaps = overlapsJson as unknown as Overlap[];
const index = indexProjects(projects);

describe("filterOverlaps", () => {
  it("keeps all 6 in rank order with no filters", () => {
    expect(filterOverlaps(overlaps, index, EMPTY_FILTERS).map((o) => o.id)).toEqual([
      "OVL_1", "OVL_2", "OVL_3", "OVL_4", "OVL_5", "OVL_6",
    ]);
  });

  it("time overlaps only keeps OVL_2 and OVL_5", () => {
    const out = filterOverlaps(overlaps, index, { ...EMPTY_FILTERS, timeOnly: true });
    expect(out.map((o) => o.id)).toEqual(["OVL_2", "OVL_5"]);
  });

  it("keeps a pair when either project is in service inside the range", () => {
    // Only GPC_1 (2033-06-01) falls in 2030 to 2035, so only its pairs stay.
    const out = filterOverlaps(overlaps, index, { start: "2030-01-01", end: "2035-12-31", timeOnly: false });
    expect(out.map((o) => o.id)).toEqual(["OVL_1", "OVL_4"]);
  });

  it("returns nothing when no project fits", () => {
    expect(filterOverlaps(overlaps, index, { start: "2040-01-01", end: "", timeOnly: false })).toEqual([]);
  });
});

describe("details", () => {
  it("puts GPC first", () => {
    const pair = sides(overlaps[0], index)!;
    expect(pair.map((p) => p.properties.utility)).toEqual(["GPC", "DESC"]);
  });

  it("says Centroid unless both sides are osm_line", () => {
    const pair = sides(overlaps[0], index)!;
    expect(accuracy(pair)).toBe("Centroid");
    const exact = pair.map((p) => ({ ...p, properties: { ...p.properties, geometry_quality: "osm_line" } })) as [Project, Project];
    expect(accuracy(exact)).toBe("Exact");
  });

  it("bounds cover both points", () => {
    const [[w, s], [e, n]] = overlapBounds(overlaps[0], sides(overlaps[0], index));
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });

  it("formats text", () => {
    expect(formatKm(6.58)).toBe("6.58 km");
    expect(formatKm(23.83)).toBe("23.83 km");
    expect(cleanText("A &amp; B")).toBe("A & B");
  });
});

describe("places", () => {
  it("matches by prefix first", () => {
    expect(matchPlaces("sav")[0].name).toBe("Savannah, GA");
    expect(matchPlaces("")).toEqual([]);
  });
});
