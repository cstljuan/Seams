import { describe, expect, it } from "vitest";
import projects from "@/data/fixtures/projects.geojson";
import overlaps from "@/data/fixtures/overlaps.json";

describe("fixtures", () => {
  it("has 10 projects and 6 overlaps", () => {
    expect(projects.features).toHaveLength(10);
    expect(overlaps).toHaveLength(6);
  });
});
