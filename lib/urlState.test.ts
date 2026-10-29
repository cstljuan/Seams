import { describe, expect, it } from "vitest";
import { buildUrlState, parseUrlState } from "./urlState";

describe("url state", () => {
  it("round-trips everything it knows", () => {
    const state = {
      dataset: "illustrative" as const,
      pair: "OVL_LMP_3_MIP_7",
      from: "2027-01-01",
      to: "2030-12-31",
      timeOnly: true,
      scope: "FL",
      spotlight: "MGV",
      mapView: "time" as const,
      year: 2029,
      view: [-80.1918, 25.7617, 9.5] as [number, number, number],
    };
    expect(parseUrlState(buildUrlState(state))).toEqual(state);
  });

  it("ignores junk and anything that is not an id, date or code", () => {
    expect(parseUrlState("?pair=<script>&from=yesterday&s=florida&view=1,2&mv=4d&y=12")).toEqual({});
  });

  it("leaves the default flat view and empty state out of the link", () => {
    expect(buildUrlState({ mapView: "flat" })).toBe("");
  });
});
