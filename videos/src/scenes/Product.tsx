import React from "react";
import { interpolate, OffthreadVideo, staticFile, useCurrentFrame, Easing } from "remotion";
import { C, FONT } from "../theme";
import { Arc, useEnter } from "../parts";
import { CAPTURED, COUNTS, LIVE_URL } from "../data";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Real footage: headless Chromium screencast of the production app, 1600x900, shown at 1.2x.
// Timeline markers from the capture log (clip starts 3.6 s in, once the map and list have loaded).
const TRIM_S = 3.6;

type Cue = { from: number; to: number; text: React.ReactNode };

const Caption: React.FC<{ cue: Cue; align: "map" | "center" }> = ({ cue, align }) => {
  const frame = useCurrentFrame();
  const inO = interpolate(frame, [cue.from, cue.from + 10], [0, 1], clamp);
  const outO = interpolate(frame, [cue.to - 10, cue.to], [1, 0], clamp);
  const o = Math.min(inO, outO);
  if (o <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: align === "map" ? 72 : 0,
        right: align === "map" ? undefined : 0,
        bottom: 64,
        display: "flex",
        justifyContent: align === "map" ? "flex-start" : "center",
        opacity: o,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          background: "rgba(11,20,34,0.92)",
          color: C.text,
          fontFamily: FONT,
          fontSize: 38,
          fontWeight: 500,
          lineHeight: 1.2,
          padding: "18px 28px 18px 20px",
          borderRadius: 16,
          maxWidth: align === "map" ? 1150 : 1500,
        }}
      >
        <Arc size={46} />
        <span>{cue.text}</span>
      </div>
    </div>
  );
};

export const Product: React.FC<{ len?: number; startS?: number; cues?: Cue[]; zoomAt?: number }> = ({
  len = 920,
  startS = TRIM_S,
  cues,
  zoomAt = 572,
}) => {
  const frame = useCurrentFrame();
  const list: Cue[] = cues ?? [
    { from: 12, to: 140, text: <>The live app: {COUNTS.projects} sample projects, {COUNTS.overlaps} cross-utility pairs, ranked by distance.</> },
    { from: 152, to: 300, text: <>Filter to time overlaps: in-service dates within a year.</> },
    { from: 318, to: 560, text: <>Select pair #2. The map zooms to it and draws the closest link.</> },
    { from: 606, to: 905, text: <>Distance, tier, timing, accuracy, cost range and source, in one place.</> },
  ];
  // Push in on the details panel so it can be read. Box from the capture: x 1138–1583, y 224–630 (of 1600x900).
  const z = interpolate(frame, [zoomAt, zoomAt + 36], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const scale = 1.2 * (1 + 0.42 * z);
  const focusX = 1360;
  const focusY = 400;
  // Keep the focus point where it is at 1.2x, then slide it toward the frame centre.
  const tx = interpolate(z, [0, 1], [0, 960 - focusX * scale]);
  const ty = interpolate(z, [0, 1], [0, 500 - focusY * scale]);
  const chip = useEnter(4);
  return (
    <div style={{ position: "absolute", inset: 0, background: "#f3f5f8", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1600,
          height: 900,
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        <OffthreadVideo src={staticFile("footage/prod-walkthrough.mp4")} startFrom={Math.round(startS * 30)} muted style={{ width: 1600, height: 900 }} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 290,
          top: 20,
          ...chip,
          fontFamily: FONT,
          fontSize: 24,
          color: C.text,
          background: "rgba(11,20,34,0.88)",
          padding: "8px 16px",
          borderRadius: 999,
          letterSpacing: "0.02em",
        }}
      >
        <span style={{ color: C.arc, fontWeight: 700 }}>● LIVE PRODUCTION</span> · {LIVE_URL} · {CAPTURED}
      </div>
      {list.map((cue, i) => (
        <Caption key={i} cue={cue} align={cue.from >= zoomAt ? "center" : "map"} />
      ))}
    </div>
  );
};

