"use client";

import { useMemo } from "react";
import { useColorScheme } from "./useColorScheme";

// Map layers need real colour strings, not CSS variables.
// Read the theme tokens and turn each into rgba() via a 1px canvas,
// so any CSS colour format in theme.css works. Browser only (the map is not server rendered).
const TOKENS = ["--tier-1", "--tier-2", "--tier-3", "--tier-4", "--utility-a", "--utility-b", "--surface", "--text"] as const;
export type ThemeColors = Record<(typeof TOKENS)[number], string>;

function toRgba(ctx: CanvasRenderingContext2D, value: string): string {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function readColors(): ThemeColors | null {
  if (typeof document === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const out = {} as ThemeColors;
  for (const t of TOKENS) out[t] = toRgba(ctx, style.getPropertyValue(t).trim());
  return out;
}

export function useThemeColors(): ThemeColors | null {
  // Read again when the device switches between light and dark.
  const scheme = useColorScheme();
  return useMemo(() => (scheme ? readColors() : null), [scheme]);
}
