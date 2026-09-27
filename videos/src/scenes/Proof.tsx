import React from "react";
import { C } from "../theme";
import { Label, Stage, useEnter, useExit } from "../parts";

const ROWS: [string, string][] = [
  ["Data", "Sperry Tech GridLock sample package: 10 projects, 2 utilities"],
  ["Engine", "Distance, tier, time gap, ranking, cost range. Unit tested"],
  ["Storage", "MongoDB Atlas behind the app's API, with a local JSON fallback"],
  ["App", "Next.js and MapLibre, live on Vercel"],
];

// 68–81 s. What is real in this build, and what is not yet.
export const Proof: React.FC<{ len?: number }> = ({ len = 390 }) => {
  const out = useExit(len - 14, 14);
  const head = useEnter(6);
  const not = useEnter(250);
  return (
    <Stage>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <Label style={{ position: "absolute", left: 200, top: 120, ...head }}>What is real in this build</Label>
        {ROWS.map(([k, v], i) => (
          <Row key={k} k={k} v={v} at={30 + i * 40} top={210 + i * 130} />
        ))}
        <div style={{ position: "absolute", left: 200, top: 780, right: 200, borderTop: `2px solid ${C.line}`, paddingTop: 36, fontSize: 36, lineHeight: 1.3, ...not }}>
          <span style={{ color: C.arc, fontWeight: 600 }}>Not yet: </span>
          <span style={{ color: C.muted }}>full filings extraction, construction start dates, exact line routes.</span>
        </div>
      </div>
    </Stage>
  );
};

const Row: React.FC<{ k: string; v: string; at: number; top: number }> = ({ k, v, at, top }) => {
  const e = useEnter(at);
  return (
    <div style={{ position: "absolute", left: 200, right: 200, top, display: "flex", gap: 48, alignItems: "baseline", ...e }}>
      <div style={{ width: 220, fontSize: 30, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{k}</div>
      <div style={{ fontSize: 46, fontWeight: 500 }}>{v}</div>
    </div>
  );
};
