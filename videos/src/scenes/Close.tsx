import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame, Easing } from "remotion";
import { C } from "../theme";
import { Stage, useEnter } from "../parts";
import { DOMAIN } from "../data";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// 81–90 s. The two lines meet, the logo resolves, the URL holds.
export const Close: React.FC<{ len?: number; line?: string }> = ({ len = 270, line = "Where planned grid projects meet." }) => {
  const frame = useCurrentFrame();
  const meet = interpolate(frame, [0, 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const fadeLines = interpolate(frame, [44, 70], [1, 0], clamp);
  const logo = useEnter(46, 24);
  const tag = useEnter(80);
  const url = useEnter(110);
  const tail = interpolate(frame, [len - 20, len], [1, 1], clamp);
  return (
    <Stage>
      <div style={{ position: "absolute", inset: 0, opacity: tail }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: fadeLines }}>
          <line x1={0} y1={440} x2={960 * meet} y2={440} stroke={C.desc} strokeWidth={4} strokeLinecap="round" />
          <line x1={1920} y1={440} x2={1920 - 960 * meet} y2={440} stroke={C.gpc} strokeWidth={4} strokeLinecap="round" />
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, top: 250, display: "flex", justifyContent: "center", ...logo }}>
          <Img src={staticFile("brand/logo-full-dark.svg")} style={{ width: 760 }} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 610, textAlign: "center", fontSize: 58, fontWeight: 500, ...tag }}>{line}</div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 720, textAlign: "center", fontSize: 40, color: C.arc, letterSpacing: "0.02em", ...url }}>
          {DOMAIN}
        </div>
      </div>
    </Stage>
  );
};
