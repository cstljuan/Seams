// Project marker shapes for the map, drawn as signed distance fields (SDF).
// With SDF icons MapLibre can recolour each marker and draw a halo around it on the GPU,
// so hundreds of projects stay fast. Same shapes as MarkerShape in MapView.tsx.
import type { ProjectType } from "@/lib/data";

// Pixel size of each icon, including room for the halo.
export const SHAPE_PX = 48;
// How far the distance field reaches past the edge, in pixels (MapLibre's default SDF buffer).
const RADIUS = 8;
// The edge sits at alpha 0.75 in MapLibre's SDF convention.
const CUTOFF = 0.25;

type Sdf = (x: number, y: number) => number;

// Signed distances in a -1..1 box (negative inside). Shapes fill about 70% of the icon.
const S = 0.68;
const circle: Sdf = (x, y) => Math.hypot(x, y) - S;
const roundedSquare: Sdf = (x, y) => {
  const r = 0.16;
  const qx = Math.abs(x) - (S * 0.86 - r);
  const qy = Math.abs(y) - (S * 0.86 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const diamond: Sdf = (x, y) => (Math.abs(x) + Math.abs(y) - S * 1.25) / Math.SQRT2;
const triangle: Sdf = (x, y) => {
  // Equilateral, point up, centred.
  const k = Math.sqrt(3);
  const size = S * 1.05;
  let px = Math.abs(x) - size;
  let py = -y + size / k - 0.08;
  if (px + k * py > 0) [px, py] = [(px - k * py) / 2, (-k * px - py) / 2];
  px -= Math.max(-2 * size, Math.min(0, px));
  return -Math.hypot(px, py) * Math.sign(py);
};
const ring: Sdf = (x, y) => Math.abs(Math.hypot(x, y) - S * 0.78) - S * 0.2;

export const SHAPES: Record<ProjectType, Sdf> = {
  substation: circle,
  line: roundedSquare,
  rebuild: diamond,
  reconductor: triangle,
  other: ring,
};

export function shapeImage(type: ProjectType): { width: number; height: number; data: Uint8Array } {
  const sdf = SHAPES[type];
  const data = new Uint8Array(SHAPE_PX * SHAPE_PX * 4);
  const half = SHAPE_PX / 2;
  for (let py = 0; py < SHAPE_PX; py += 1) {
    for (let px = 0; px < SHAPE_PX; px += 1) {
      // Distance in pixels; the shape box is the inner part of the icon, leaving the buffer for the halo.
      const d = sdf((px + 0.5 - half) / (half - RADIUS), (py + 0.5 - half) / (half - RADIUS)) * (half - RADIUS);
      const alpha = Math.round(255 * Math.max(0, Math.min(1, 1 - CUTOFF - d / RADIUS)));
      const i = (py * SHAPE_PX + px) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alpha;
    }
  }
  return { width: SHAPE_PX, height: SHAPE_PX, data };
}
