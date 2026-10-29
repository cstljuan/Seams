// What Arc says when a pair opens: one plain line built only from the numbers in the data.
// Deterministic, so the same pair always gets the same line. If the data does not say it, Arc does not say it.
import type { Overlap, Project } from "@/lib/data";
import { formatKm } from "./overlaps";

const DAY = 86_400_000;

// What the crews could share, by tier (from the Sperry challenge tiers).
const SHARE: Record<1 | 2 | 3 | 4, string> = {
  1: "plan the outages and crossing structures together",
  2: "share the right-of-way, access roads and permits",
  3: "share a laydown yard and deliveries",
  4: "share crews and equipment",
};

function where(o: Overlap, pair: [Project, Project]): string {
  if (o.tier === 1) return "They touch or cross";
  const [a, b] = pair.map((p) => p.properties.state);
  const near = `About ${formatKm(o.distance_km)} apart`;
  return a === b ? near : `${near}, across the ${a} and ${b} line`;
}

// Months the two build windows overlap, when both have start dates.
function overlapMonths(pair: [Project, Project]): number | null {
  const [a, b] = pair.map((p) => p.properties);
  if (!a.start || !b.start) return null;
  const from = Math.max(Date.parse(a.start), Date.parse(b.start));
  const to = Math.min(Date.parse(a.in_service), Date.parse(b.in_service));
  return to > from ? Math.max(1, Math.round((to - from) / (30.44 * DAY))) : 0;
}

function when(o: Overlap, pair: [Project, Project]): string {
  const months = overlapMonths(pair);
  if (months !== null && months > 0) return `the builds overlap by ${months} ${months === 1 ? "month" : "months"}`;
  if (o.time_overlap) return "they go into service within a year of each other";
  const years = o.time_gap_days / 365;
  if (years >= 1.5) return `they go into service about ${Math.round(years)} years apart`;
  return `they go into service ${Math.round(o.time_gap_days / 30.44)} months apart`;
}

function what(pair: [Project, Project]): string {
  const [a, b] = pair.map((p) => p.properties);
  const kv = [a.voltage_kv, b.voltage_kv].filter((v): v is number => v !== null);
  const types = [...new Set([a.type, b.type])].map((t) => (t === "other" ? "project" : t));
  const kinds = types.length === 1 ? `two ${types[0]}s` : `a ${types[0]} and a ${types[1]}`;
  return kv.length ? `${kinds} (${[...new Set(kv)].join(" and ")} kV)` : kinds;
}

export function narrate(o: Overlap, pair: [Project, Project]): string {
  const timing = when(o, pair);
  // Close in place and in time is the case worth acting on first.
  const urge = (o.tier <= 2 && o.time_overlap) || o.tier === 1 ? "Worth a call this week: " : "";
  return `#${o.rank}: ${where(o, pair)}, and ${timing}. ${pair[0].properties.utility} and ${pair[1].properties.utility}, ${what(pair)}. ${urge}they could ${SHARE[o.tier]}.`;
}
