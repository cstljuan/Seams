import type { Overlap, Project } from "@/lib/data";
import { estimateCost } from "./cost";
import { closestDistanceKm, rankOverlaps, tier, timeGapDays, timeOverlap } from "./overlap";

// Largest distance that still counts as an overlap (tier 4).
const MAX_KM = 40;
const KM_PER_DEG_LAT = 111.32;

type Box = [number, number, number, number]; // west, south, east, north

function box(p: Project): Box {
  const pts = p.geometry.type === "Point" ? [p.geometry.coordinates] : p.geometry.coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of pts) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

// Cheap check before the exact distance: are the two boxes within MAX_KM of each other?
function boxesNear(a: Box, b: Box): boolean {
  const lat = Math.max(Math.abs(a[1]), Math.abs(a[3]));
  const dLat = MAX_KM / KM_PER_DEG_LAT;
  const dLng = MAX_KM / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return a[0] - dLng <= b[2] && b[0] - dLng <= a[2] && a[1] - dLat <= b[3] && b[1] - dLat <= a[3];
}

// Every pair of projects from two different utilities within 40 km, ranked.
// Pairs are ordered by utility code so each one has a stable id.
export function buildOverlaps(projects: Project[]): Overlap[] {
  const boxes = projects.map(box);
  const overlaps: Overlap[] = [];

  for (let i = 0; i < projects.length; i += 1) {
    for (let j = i + 1; j < projects.length; j += 1) {
      let a = projects[i];
      let b = projects[j];
      if (a.properties.utility === b.properties.utility) continue;
      if (!boxesNear(boxes[i], boxes[j])) continue;
      if (a.properties.utility > b.properties.utility) [a, b] = [b, a];

      const closest = closestDistanceKm(a, b);
      const overlapTier = tier(closest.km);
      if (overlapTier === null) continue;

      overlaps.push({
        id: `OVL_${a.properties.id}_${b.properties.id}`,
        rank: 0,
        a: a.properties.id,
        b: b.properties.id,
        distance_km: Number(closest.km.toFixed(2)),
        tier: overlapTier,
        time_gap_days: timeGapDays(a, b),
        time_overlap: timeOverlap(a, b),
        closest_points: closest.points,
        approximate: a.properties.geometry_quality !== "osm_line" || b.properties.geometry_quality !== "osm_line",
        cost: estimateCost({ a, b, tier: overlapTier, distanceKm: closest.km }),
      });
    }
  }

  return rankOverlaps(overlaps) as Overlap[];
}
