// Groups overlaps into hexagons for the zoomed-out map. Pure functions, so they are easy to test.
// Hexagons are laid out in Web Mercator metres, so they look the same size on screen everywhere.
import type { LngLat, Overlap } from "@/lib/data";

const R = 6_378_137;
const SQRT3 = Math.sqrt(3);

function toMercator([lng, lat]: LngLat): [number, number] {
  const clamped = Math.max(-85, Math.min(85, lat));
  return [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))];
}

function toLngLat([x, y]: [number, number]): LngLat {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

// Pointy-top axial coordinates for a point, rounded to the nearest hexagon.
export function hexOf(at: LngLat, size: number): [number, number] {
  const [x, y] = toMercator(at);
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - (-q - r));
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz >= dy) rz = -rx - ry;
  return [rx, rz];
}

export function hexPolygon([q, r]: [number, number], size: number): LngLat[] {
  const cx = size * SQRT3 * (q + r / 2);
  const cy = size * 1.5 * r;
  const ring: LngLat[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    ring.push(toLngLat([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]));
  }
  ring.push(ring[0]);
  return ring;
}

export interface HexProps {
  key: string;
  count: number;
  // 0 to 1, this hexagon's count against the busiest one.
  share: number;
  // The most severe tier inside.
  tier: 1 | 2 | 3 | 4;
  bbox: [number, number, number, number];
}

const middle = (o: Overlap): LngLat => [
  (o.closest_points[0][0] + o.closest_points[1][0]) / 2,
  (o.closest_points[0][1] + o.closest_points[1][1]) / 2,
];

export function hexbin(overlaps: Overlap[], size: number): GeoJSON.FeatureCollection<GeoJSON.Polygon, HexProps> {
  const cells = new Map<string, { hex: [number, number]; count: number; tier: 1 | 2 | 3 | 4; bbox: [number, number, number, number] }>();
  for (const o of overlaps) {
    const at = middle(o);
    const hex = hexOf(at, size);
    const key = `${hex[0]},${hex[1]}`;
    const cell = cells.get(key);
    if (!cell) {
      cells.set(key, { hex, count: 1, tier: o.tier, bbox: [at[0], at[1], at[0], at[1]] });
      continue;
    }
    cell.count += 1;
    cell.tier = Math.min(cell.tier, o.tier) as 1 | 2 | 3 | 4;
    cell.bbox = [Math.min(cell.bbox[0], at[0]), Math.min(cell.bbox[1], at[1]), Math.max(cell.bbox[2], at[0]), Math.max(cell.bbox[3], at[1])];
  }
  const max = Math.max(1, ...[...cells.values()].map((c) => c.count));
  return {
    type: "FeatureCollection",
    features: [...cells.entries()].map(([key, c]) => ({
      type: "Feature",
      properties: { key, count: c.count, share: c.count / max, tier: c.tier, bbox: c.bbox },
      geometry: { type: "Polygon", coordinates: [hexPolygon(c.hex, size)] },
    })),
  };
}
