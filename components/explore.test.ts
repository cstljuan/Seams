import { describe, expect, it } from "vitest";
import projectsFc from "@/data/fixtures/projects.geojson";
import overlapsJson from "@/data/overlaps.json";
import type { Overlap, Project } from "@/lib/data";
import { groupOverlaps, honestSavings, involves, neighbours, sortOverlaps } from "./explore";
import { indexProjects } from "./overlaps";

const projects = (projectsFc as unknown as { features: Project[] }).features;
// The built sample overlaps have costs; the fixtures do not.
const overlaps = overlapsJson as unknown as Overlap[];
const index = indexProjects(projects);

describe("sortOverlaps", () => {
  it("keeps rank order for severity", () => {
    expect(sortOverlaps(overlaps, "severity", index).map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts the smallest time gap first", () => {
    const gaps = sortOverlaps(overlaps, "closest-time", index).map((o) => o.time_gap_days);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
  });

  it("puts the biggest P50 first", () => {
    const p50 = sortOverlaps(overlaps, "savings", index).map((o) => o.cost!.p50);
    expect(p50).toEqual([...p50].sort((a, b) => b - a));
  });

  it("does not change the input list", () => {
    const before = overlaps.map((o) => o.id);
    sortOverlaps(overlaps, "distance", index);
    expect(overlaps.map((o) => o.id)).toEqual(before);
  });
});

describe("groupOverlaps", () => {
  it("groups by tier in tier order and keeps every pair", () => {
    const groups = groupOverlaps(overlaps, "tier", index);
    expect(groups.map((g) => g.key)).toEqual([...groups.map((g) => g.key)].sort());
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(overlaps.length);
  });

  it("names utility pairs in A to Z order", () => {
    expect(groupOverlaps(overlaps, "pair", index)[0].label).toBe("DESC and GPC");
  });

  it("lists a pair across a state line under both states", () => {
    const groups = groupOverlaps(overlaps, "state", index);
    expect(groups.map((g) => g.key).sort()).toEqual(["GA", "SC"]);
    expect(groups.every((g) => g.items.length === overlaps.length)).toBe(true);
  });
});

describe("honestSavings", () => {
  it("counts each project once", () => {
    const s = honestSavings(overlaps);
    // 10 projects, so at most 5 pairs can be taken without sharing one.
    expect(s.pairs).toBeLessThanOrEqual(5);
    expect(s.p10).toBeLessThanOrEqual(s.p90);
  });

  it("is never more than adding every range", () => {
    const s = honestSavings(overlaps);
    const all = overlaps.reduce((n, o) => n + (o.cost?.p90 ?? 0), 0);
    expect(s.p90).toBeLessThanOrEqual(all);
  });
});

describe("spotlight helpers", () => {
  it("finds every pair a utility is in, and ranks its neighbours", () => {
    expect(overlaps.every((o) => involves(o, "GPC", index))).toBe(true);
    const n = neighbours(overlaps, "GPC", index);
    expect(n).toEqual([{ code: "DESC", pairs: overlaps.length, close: overlaps.filter((o) => o.tier <= 2).length }]);
  });
});
