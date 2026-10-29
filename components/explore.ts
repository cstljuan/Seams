// Ways to explore the list: sort, group, honest savings, and which utilities collide most.
// Pure functions, so they are easy to test.
import type { Overlap } from "@/lib/data";
import { TIER_LABELS, type ProjectIndex } from "./overlaps";

export type SortKey = "severity" | "soonest" | "closest-time" | "savings" | "distance";
export const SORTS: { id: SortKey; label: string }[] = [
  { id: "severity", label: "Severity" },
  { id: "soonest", label: "Soonest build" },
  { id: "closest-time", label: "Closest in time" },
  { id: "savings", label: "Biggest savings" },
  { id: "distance", label: "Closest distance" },
];

export type GroupKey = "none" | "tier" | "year" | "pair" | "state";
export const GROUPS: { id: GroupKey; label: string }[] = [
  { id: "none", label: "No groups" },
  { id: "tier", label: "Tier" },
  { id: "year", label: "Year" },
  { id: "pair", label: "Utility pair" },
  { id: "state", label: "State" },
];

// When the earlier of the two projects starts work (its start date, or its in-service date if none).
function earliestStart(o: Overlap, index: ProjectIndex): string {
  const dates = [index.get(o.a), index.get(o.b)].map((p) => p?.properties.start ?? p?.properties.in_service ?? "9999");
  return dates.sort()[0];
}

// The rank stays the severity rank, so "#12" means the same thing whatever the sort.
export function sortOverlaps(list: Overlap[], key: SortKey, index: ProjectIndex): Overlap[] {
  const out = [...list];
  const byRank = (x: Overlap, y: Overlap) => x.rank - y.rank;
  switch (key) {
    case "soonest":
      return out.sort((x, y) => earliestStart(x, index).localeCompare(earliestStart(y, index)) || byRank(x, y));
    case "closest-time":
      return out.sort((x, y) => x.time_gap_days - y.time_gap_days || byRank(x, y));
    case "savings":
      return out.sort((x, y) => (y.cost?.p50 ?? -1) - (x.cost?.p50 ?? -1) || byRank(x, y));
    case "distance":
      return out.sort((x, y) => x.distance_km - y.distance_km || byRank(x, y));
    default:
      return out.sort(byRank);
  }
}

export interface Group {
  key: string;
  label: string;
  items: Overlap[];
}

// Groups keep the list's order inside each group. Group order: tier 1 first, years ascending,
// pairs and states by size (biggest first).
export function groupOverlaps(list: Overlap[], key: GroupKey, index: ProjectIndex): Group[] {
  if (key === "none") return [{ key: "all", label: "All", items: list }];
  const groups = new Map<string, Group>();
  const add = (k: string, label: string, o: Overlap) => {
    const g = groups.get(k) ?? { key: k, label, items: [] };
    g.items.push(o);
    groups.set(k, g);
  };
  for (const o of list) {
    const a = index.get(o.a)?.properties;
    const b = index.get(o.b)?.properties;
    if (key === "tier") add(String(o.tier), `Tier ${o.tier}: ${TIER_LABELS[o.tier].split(":")[0]}`, o);
    else if (key === "year") {
      const year = [a?.in_service, b?.in_service].filter(Boolean).sort()[0]?.slice(0, 4) ?? "Unknown";
      add(year, year, o);
    } else if (key === "pair") {
      const codes = [a?.utility ?? "?", b?.utility ?? "?"].sort();
      add(codes.join("|"), `${codes[0]} and ${codes[1]}`, o);
    } else {
      // A pair across a state line shows up under both states.
      for (const st of new Set([a?.state, b?.state])) if (st) add(st, st, o);
    }
  }
  const out = [...groups.values()];
  if (key === "tier" || key === "year") return out.sort((x, y) => x.key.localeCompare(y.key));
  return out.sort((x, y) => y.items.length - x.items.length || x.label.localeCompare(y.label));
}

// Savings for a set of pairs without double counting. Pairs share projects, so adding every pair's
// range would count the same project's savings many times. Take pairs by P50, biggest first, and skip
// a pair if either project is already used; then add up P10 and P90 of the pairs taken.
export function honestSavings(list: Overlap[]): { pairs: number; p10: number; p90: number } {
  const used = new Set<string>();
  let pairs = 0;
  let p10 = 0;
  let p90 = 0;
  for (const o of [...list].filter((x) => x.cost).sort((x, y) => y.cost!.p50 - x.cost!.p50)) {
    if (used.has(o.a) || used.has(o.b)) continue;
    used.add(o.a);
    used.add(o.b);
    pairs += 1;
    p10 += o.cost!.p10;
    p90 += o.cost!.p90;
  }
  return { pairs, p10, p90 };
}

// For a spotlighted utility: which other utilities it pairs with most, and how many of those are tier 1 or 2.
export function neighbours(list: Overlap[], utility: string, index: ProjectIndex): { code: string; pairs: number; close: number }[] {
  const counts = new Map<string, { code: string; pairs: number; close: number }>();
  for (const o of list) {
    const ua = index.get(o.a)?.properties.utility;
    const ub = index.get(o.b)?.properties.utility;
    const other = ua === utility ? ub : ub === utility ? ua : null;
    if (!other) continue;
    const c = counts.get(other) ?? { code: other, pairs: 0, close: 0 };
    c.pairs += 1;
    if (o.tier <= 2) c.close += 1;
    counts.set(other, c);
  }
  return [...counts.values()].sort((x, y) => y.pairs - x.pairs || y.close - x.close || x.code.localeCompare(y.code));
}

export function involves(o: Overlap, utility: string, index: ProjectIndex): boolean {
  return index.get(o.a)?.properties.utility === utility || index.get(o.b)?.properties.utility === utility;
}
