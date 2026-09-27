import React from "react";
import { interpolate, useCurrentFrame, Easing } from "remotion";
import { C, MONO } from "../theme";
import { Label, Stage, useEnter, useExit } from "../parts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// 8–20 s. Concept diagram: close in space, close in time. Not measured geometry.
export const Concept: React.FC<{ len?: number }> = ({ len = 360 }) => {
  const frame = useCurrentFrame();
  const out = useExit(len - 14, 14);
  const ease = Easing.out(Easing.cubic);
  const rings = [
    { r: 70, label: "1.6 km · share land" },
    { r: 140, label: "8 km · share site logistics" },
    { r: 215, label: "40 km · share crews" },
  ];
  const ringP = (i: number) => interpolate(frame, [30 + i * 14, 60 + i * 14], [0, 1], { ...clamp, easing: ease });
  const link = interpolate(frame, [95, 130], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const axis = interpolate(frame, [120, 160], [0, 1], { ...clamp, easing: ease });
  const bracket = interpolate(frame, [190, 225], [0, 1], { ...clamp, easing: ease });
  const left = useEnter(10);
  const right = useEnter(115);
  const foot = useEnter(240);
  // Left panel centre
  const cx = 470;
  const cy = 560;
  // Timeline, right panel
  const x0 = 1080;
  const x1 = 1800;
  const year = (y: number) => x0 + ((y - 2024) / 4) * (x1 - x0);
  const a = year(2025.99); // DESC in service, Dec 31 2025
  const b = year(2026.41); // GPC in service, Jun 1 2026
  return (
    <Stage>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <Label style={{ position: "absolute", left: 120, top: 80 }}>Concept · not to scale</Label>
        <div style={{ position: "absolute", left: 120, top: 150, fontSize: 60, fontWeight: 600, ...left }}>Close in space</div>
        <div style={{ position: "absolute", left: 1080, top: 150, fontSize: 60, fontWeight: 600, ...right }}>Close in time</div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {rings.map((ring, i) => (
            <g key={ring.r} opacity={ringP(i)}>
              <circle cx={cx} cy={cy} r={ring.r * ringP(i)} fill="none" stroke={C.muted} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="6 8" />
            </g>
          ))}
          <line x1={cx} y1={cy} x2={cx + (175 - 0) * link} y2={cy - 70 * link} stroke={C.tier4} strokeWidth={5} strokeLinecap="round" />
          <rect x={cx - 12} y={cy - 12} width={24} height={24} rx={3} fill={C.desc} />
          <rect x={cx + 175 - 12} y={cy - 70 - 12} width={24} height={24} rx={3} fill={C.gpc} opacity={interpolate(frame, [80, 95], [0, 1], clamp)} />
          {/* Timeline */}
          <line x1={x0} y1={560} x2={x0 + (x1 - x0) * axis} y2={560} stroke={C.muted} strokeWidth={2} />
          {[2024, 2025, 2026, 2027, 2028].map((y) => (
            <g key={y} opacity={axis}>
              <line x1={year(y)} y1={552} x2={year(y)} y2={568} stroke={C.muted} strokeWidth={2} />
              <text x={year(y)} y={604} fill={C.muted} fontSize={24} fontFamily={MONO} textAnchor="middle">
                {y}
              </text>
            </g>
          ))}
          <g opacity={interpolate(frame, [150, 170], [0, 1], clamp)}>
            <circle cx={a} cy={560} r={11} fill={C.desc} />
            <text x={a} y={520} fill={C.desc} fontSize={26} textAnchor="end" fontFamily="Afacad">DESC in service</text>
            <circle cx={b} cy={560} r={11} fill={C.gpc} />
            <text x={b} y={658} fill={C.gpc} fontSize={26} textAnchor="start" fontFamily="Afacad">GPC in service</text>
          </g>
          <g opacity={bracket}>
            <path d={`M ${a} 700 L ${a} 716 L ${b} 716 L ${b} 700`} fill="none" stroke={C.arc} strokeWidth={3} />
          </g>
        </svg>
        {rings.map((ring, i) => (
          <div
            key={ring.label}
            style={{ position: "absolute", left: cx + ring.r * 0.72 + 8, top: cy + ring.r * 0.72 - 4 + i * 0, fontSize: 22, color: C.muted, opacity: ringP(i), whiteSpace: "nowrap" }}
          >
            {ring.label}
          </div>
        ))}
        <div style={{ position: "absolute", left: 120, top: 840, fontSize: 30, color: C.text, opacity: link }}>
          Closest distance sets the tier.
        </div>
        <div style={{ position: "absolute", left: 1080, top: 734, fontSize: 30, color: C.arc, opacity: bracket, whiteSpace: "nowrap" }}>
          In service within 365 days → “time overlap”
        </div>
        <div style={{ position: "absolute", left: 1080, top: 840, fontSize: 26, color: C.muted, maxWidth: 720, lineHeight: 1.3, opacity: bracket }}>
          Start dates are not in the sample data yet, so in-service dates stand in for build windows.
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 960, textAlign: "center", fontSize: 40, fontWeight: 600, ...foot }}>
          Seams checks both for each cross-utility pair.
        </div>
      </div>
    </Stage>
  );
};
