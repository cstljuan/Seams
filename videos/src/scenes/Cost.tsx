import React from "react";
import { interpolate, useCurrentFrame, Easing } from "remotion";
import { C, MONO } from "../theme";
import { Label, Stage, useEnter, useExit } from "../parts";
import { PAIR } from "../data";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const k = (n: number) => `$${(n / 1000).toFixed(1)}K`;

// 50.7–68 s. The modelled range and its qualifier, always on screen together.
export const Cost: React.FC<{ len?: number }> = ({ len = 520 }) => {
  const frame = useCurrentFrame();
  const out = useExit(len - 14, 14);
  const head = useEnter(8);
  const big = useEnter(30);
  const bar = interpolate(frame, [60, 110], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const notes = useEnter(150);
  // Bar maps $10K–$40K onto x 260–1660.
  const x = (v: number) => 260 + ((v - 10000) / 30000) * 1400;
  const x10 = x(PAIR.p10);
  const x90 = x(PAIR.p90);
  const x50 = x(PAIR.p50);
  return (
    <Stage>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <Label style={{ position: "absolute", left: 260, top: 110, ...head }}>
          Pair #{PAIR.rank} · modelled cost of not coordinating
        </Label>
        <div style={{ position: "absolute", left: 260, top: 170, fontSize: 150, fontWeight: 600, fontFamily: MONO, letterSpacing: "-0.03em", ...big }}>
          {k(PAIR.p10)} <span style={{ color: C.muted }}>–</span> {k(PAIR.p90)}
        </div>
        <div style={{ position: "absolute", left: 260, top: 370, fontSize: 40, color: C.arc, fontWeight: 600, ...big }}>
          An estimate range (P10 to P90), not a quote or a measured saving.
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={260} y1={560} x2={1660} y2={560} stroke={C.line} strokeWidth={2} />
          <rect x={x10} y={544} width={(x90 - x10) * bar} height={32} rx={16} fill={C.tier4} opacity={0.85} />
          <g opacity={interpolate(frame, [100, 120], [0, 1], clamp)}>
            <line x1={x50} y1={532} x2={x50} y2={588} stroke={C.text} strokeWidth={3} />
            {[
              [x10, "P10 " + k(PAIR.p10)],
              [x50, "P50 " + k(PAIR.p50)],
              [x90, "P90 " + k(PAIR.p90)],
            ].map(([px, t]) => (
              <text key={String(t)} x={Number(px)} y={632} fill={C.muted} fontSize={26} fontFamily={MONO} textAnchor="middle">
                {t}
              </text>
            ))}
          </g>
        </svg>
        <div style={{ position: "absolute", left: 260, top: 700, width: 1400, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 48, fontSize: 30, lineHeight: 1.3, ...notes }}>
          <div>
            <div style={{ color: C.muted, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>What it counts</div>
            At tier 4: a share of mobilisation cost, plus shared equipment days.
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>How</div>
            2,000 seeded draws over ranges from public benchmarks (MISO, ATRI, BLS).
          </div>
          <div>
            <div style={{ color: C.muted, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Limits</div>
            Assumes one mile per project and approximate locations. Per pair, never summed.
          </div>
        </div>
      </div>
    </Stage>
  );
};
