import type { Overlap, Project } from "@/lib/data";
import { TIER_LABELS, accuracy, cleanText, formatDate, formatKm, formatUsd } from "./overlaps";

// Plain words for the schedule relationship. When both projects have start dates the engine compares
// the build windows. Otherwise "within a year" is about in-service dates, not proven overlapping construction.
export function scheduleText(o: Overlap, pair?: [Project, Project]): string {
  const years = (o.time_gap_days / 365).toFixed(1);
  if (pair?.every((p) => p.properties.start)) {
    return o.time_overlap
      ? `The build windows overlap. In-service dates are ${o.time_gap_days} days apart.`
      : `The build windows do not overlap. In-service dates are ${o.time_gap_days} days apart (about ${years} years).`;
  }
  return o.time_overlap
    ? `In-service dates are ${o.time_gap_days} days apart (within a year). Build schedules may overlap; construction start dates are not in the data.`
    : `In-service dates are ${o.time_gap_days} days apart (about ${years} years). Nearby, but not a schedule match.`;
}

// A client-side coordination brief. Nothing is sent or saved anywhere.
export function buildBrief(o: Overlap, pair: [Project, Project], generatedAt = new Date()): string {
  const acc = accuracy(pair);
  const lines = [
    `# Seams coordination brief: overlap #${o.rank}`,
    ``,
    `Generated ${generatedAt.toISOString().slice(0, 10)} from the Seams ${
      pair.some((p) => p.properties.synthetic) ? "illustrative dataset (made-up plans, not real utility projects)" : "sample data"
    }. Draft for human review. Nothing has been sent to either utility.`,
    ``,
    `## Projects`,
    ...pair.map(
      (p) =>
        `- ${p.properties.utility} (${p.properties.utility_name}): ${cleanText(p.properties.name)}. In service ${formatDate(p.properties.in_service)}.`,
    ),
    ``,
    `## Relationship`,
    `- Closest distance: ${formatKm(o.distance_km)}${o.approximate ? " (approximate)" : ""}`,
    `- Tier ${o.tier}: ${TIER_LABELS[o.tier]}`,
    `- Schedule: ${scheduleText(o, pair)}`,
    `- Location accuracy: ${acc}${
      acc === "Centroid"
        ? " (at least one side is an approximate point, not a surveyed line)"
        : acc === "Illustrative"
          ? " (illustrative dataset: made-up plans placed on real towns, not real utility projects)"
          : ""
    }`,
    ``,
    `## Cost of not coordinating (model estimate)`,
    o.cost
      ? `- P10 ${formatUsd(o.cost.p10)}, P50 ${formatUsd(o.cost.p50)}, P90 ${formatUsd(o.cost.p90)}. A Monte Carlo range from public benchmarks, not a utility quote or guaranteed savings.`
      : `- Not estimated for this pair.`,
    ``,
    `## Sources`,
    ...pair.map((p) => `- ${p.properties.id}: ${p.properties.source.doc}${p.properties.source.page != null ? `, p. ${p.properties.source.page}` : ""}`),
    ``,
    `## Suggested next checks (suggestions only)`,
    `- Confirm both project routes and substations against the utilities' own filings.`,
    `- Ask each utility for construction start and outage windows; the data only has in-service dates.`,
    `- If windows are close, check shared access roads, laydown yards and crews for the tier above.`,
    `- Re-run the cost range with project-specific miles and voltage before quoting any number.`,
    ``,
  ];
  return lines.join("\n");
}
