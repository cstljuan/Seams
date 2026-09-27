import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, FONT } from "./theme";

// Arc idle mark, geometry copied from public/brand/logo-mark-only.svg (snapshot v1-822e7aa).
// One colour, two cut-out eyes, no mouth. Motion is a small body pulse driven by the frame.
const ARC_PATH =
  "M113.92 6.43C119.91 6.00 122.57 8.77 121.91 14.73L115.89 68.85C115.23 74.81 117.87 78.18 123.82 78.97L129.98 79.79C135.93 80.57 136.74 83.05 132.42 87.23L53.38 163.54C49.06 167.70 48.00 167.00 50.20 161.42L69.60 112.16C71.80 106.58 69.90 103.95 63.91 104.29L45.89 105.29C39.90 105.62 36.96 102.79 37.09 96.79L38.71 20.79C38.84 14.79 41.89 11.57 47.88 11.15L113.92 6.43ZM64.90 27.79C60.76 27.79 57.40 34.05 57.40 41.79C57.40 49.52 60.76 55.79 64.90 55.79C69.04 55.79 72.40 49.52 72.40 41.79C72.40 34.05 69.04 27.79 64.90 27.79ZM94.90 27.79C90.76 27.79 87.40 34.05 87.40 41.79C87.40 49.52 90.76 55.79 94.90 55.79C99.04 55.79 102.40 49.52 102.40 41.79C102.40 34.05 99.04 27.79 94.90 27.79Z";

export const Arc: React.FC<{ size: number; pulse?: boolean; style?: React.CSSProperties }> = ({ size, pulse = true, style }) => {
  const frame = useCurrentFrame();
  // Slow breathing: about 2.4 s per cycle, under 3% scale.
  const s = pulse ? 1 + 0.025 * Math.sin((frame / 72) * Math.PI * 2) : 1;
  return (
    <svg viewBox="0 0 173.7 173.7" width={size} height={size} style={{ overflow: "visible", ...style }}>
      <g transform={`translate(86.85 165) scale(${s} ${2 - s}) translate(-86.85 -165)`}>
        <path d={ARC_PATH} fill={C.arc} fillRule="evenodd" clipRule="evenodd" />
      </g>
    </svg>
  );
};

// Fade and small rise for text. Position is fixed after entry, so text never jumps.
export const useEnter = (at: number, dur = 18) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 16}px)` };
};

export const useExit = (at: number, dur = 12) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [at, at + dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

export const Label: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.muted,
  style,
}) => (
  <div
    style={{
      fontFamily: FONT,
      fontSize: 24,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color,
      fontWeight: 600,
      ...style,
    }}
  >
    {children}
  </div>
);

// The recurring seam: two utility lines meet at the centre, then part. Used at scene cuts.
export const SeamWipe: React.FC<{ at: number; dur?: number }> = ({ at, dur = 24 }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > dur) return null;
  const inP = interpolate(t, [0, dur * 0.5], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const outP = interpolate(t, [dur * 0.5, dur], [0, 1], { extrapolateLeft: "clamp", easing: Easing.inOut(Easing.cubic) });
  const half = 960;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <line x1={0 + outP * half} y1={540} x2={inP * half} y2={540} stroke={C.desc} strokeWidth={4} strokeLinecap="round" />
      <line x1={1920 - outP * half} y1={540} x2={1920 - inP * half} y2={540} stroke={C.gpc} strokeWidth={4} strokeLinecap="round" />
      {inP > 0.98 && outP < 0.9 && <circle cx={960} cy={540} r={8 * (1 - outP)} fill={C.arc} />}
    </svg>
  );
};

export const useSpring = (at: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping } });
};

export const Stage: React.FC<{ children: React.ReactNode; bg?: string }> = ({ children, bg = C.bg }) => (
  <div style={{ position: "absolute", inset: 0, background: bg, fontFamily: FONT, color: C.text, overflow: "hidden" }}>
    {children}
  </div>
);
