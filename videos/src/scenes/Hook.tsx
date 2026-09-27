import React from "react";
import { interpolate, useCurrentFrame, Easing } from "remotion";
import { C } from "../theme";
import { Label, Stage, useEnter, useExit } from "../parts";

// 0–8 s. Two separate plans, drawn as two lines that never get compared.
export const Hook: React.FC<{ len?: number }> = ({ len = 240 }) => {
  const frame = useCurrentFrame();
  const draw = (at: number) =>
    interpolate(frame, [at, at + 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  // Late in the scene the two lines lean toward each other. The gap is the question.
  const lean = interpolate(frame, [len * 0.5, len * 0.85], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const yA = 330 + lean * 170;
  const yB = 750 - lean * 170;
  const pathA = `M -20 330 C 500 330, 700 ${yA}, 960 ${yA} S 1500 330, 1940 330`;
  const pathB = `M -20 750 C 500 750, 700 ${yB}, 960 ${yB} S 1500 750, 1940 750`;
  const L = 2400;
  const out = useExit(len - 14, 14);
  const gapOpacity = interpolate(frame, [len * 0.8, len * 0.9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const t1 = useEnter(20);
  const t1out = useExit(len * 0.48, 12);
  const t2 = useEnter(len * 0.52);
  return (
    <Stage>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <path d={pathA} fill="none" stroke={C.desc} strokeWidth={5} strokeDasharray={L} strokeDashoffset={L * (1 - draw(0))} />
          <path d={pathB} fill="none" stroke={C.gpc} strokeWidth={5} strokeDasharray={L} strokeDashoffset={L * (1 - draw(12))} />
          <g opacity={gapOpacity}>
            <line x1={960} y1={yA + 14} x2={960} y2={yB - 14} stroke={C.arc} strokeWidth={3} strokeDasharray="6 10" />
          </g>
        </svg>
        <Label color={C.desc} style={{ position: "absolute", left: 120, top: 262, opacity: draw(10) }}>
          Dominion Energy South Carolina · planned projects
        </Label>
        <Label color={C.gpc} style={{ position: "absolute", left: 120, top: 784, opacity: draw(22) }}>
          Georgia Power · planned projects
        </Label>
        <div style={{ position: "absolute", left: 0, right: 0, top: 470, textAlign: "center", fontSize: 76, fontWeight: 600, ...t1, opacity: t1.opacity * t1out }}>
          Two utilities. Two separate plans.
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 96,
            textAlign: "center",
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1.1,
            ...t2,
          }}
        >
          Where their projects come close,{" "}
          <span style={{ color: C.arc }}>who is checking?</span>
        </div>
      </div>
    </Stage>
  );
};
