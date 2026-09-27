import { describe, expect, it } from "vitest";
import projects from "@/data/fixtures/projects.geojson";
import overlaps from "@/data/fixtures/overlaps.json";
import type { Overlap, Project } from "@/lib/data";
import { buildBrief, scheduleText } from "./brief";
import { indexProjects, sides } from "./overlaps";

const all = (projects as unknown as { features: Project[] }).features;
const index = indexProjects(all);
const list = overlaps as unknown as Overlap[];

describe("brief", () => {
  it("does not call a years-apart pair a schedule match", () => {
    const o = { ...list[0], time_overlap: false, time_gap_days: 3074 };
    expect(scheduleText(o)).toContain("not a schedule match");
  });

  it("says a time overlap is about in-service dates only", () => {
    const o = { ...list[0], time_overlap: true, time_gap_days: 152 };
    expect(scheduleText(o)).toContain("construction start dates are not in the data");
  });

  it("shows a cost range as an estimate and says nothing was sent", () => {
    const o = { ...list[0], cost: { p10: 17231, p50: 23365, p90: 30485, currency: "USD" as const, trucks_saved: 1, co2_t: 0.1 } };
    const text = buildBrief(o, sides(o, index)!, new Date("2026-09-27T00:00:00Z"));
    expect(text).toContain("P10");
    expect(text).toContain("P90");
    expect(text).toContain("not a utility quote");
    expect(text).toContain("Nothing has been sent");
    expect(text).toContain("suggestions only");
  });

  it("handles a missing cost", () => {
    const o = { ...list[0], cost: null };
    expect(buildBrief(o, sides(o, index)!)).toContain("Not estimated for this pair");
  });
});
