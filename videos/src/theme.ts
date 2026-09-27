// Colours from the brand snapshot (public/brand/theme.css, snapshot v1-822e7aa).
// The film uses the dark Utility Navy values; app footage stays in its own light theme.
export const C = {
  bg: "#0b1422",
  surface: "#111d30",
  text: "#e8eef7",
  muted: "#8a9ab0",
  arc: "#f5bc42",
  desc: "#b8c7ff", // --utility-a, dark
  gpc: "#3ddcb4", // --utility-b, dark
  tier4: "#6ea8ff",
  line: "rgba(232,238,247,0.14)",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const FONT = "Afacad, system-ui, sans-serif";
export const MONO = "'DejaVu Sans Mono', ui-monospace, monospace";

// Scene boundaries for the 90 second film, in frames.
export const SCENES = {
  hook: [0, 240],
  concept: [240, 600],
  product: [600, 1560],
  cost: [1560, 2040],
  proof: [2040, 2430],
  close: [2430, 2700],
} as const;
