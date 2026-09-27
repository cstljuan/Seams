import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SCENES } from "./theme";
import { SeamWipe } from "./parts";
import { Hook } from "./scenes/Hook";
import { Concept } from "./scenes/Concept";
import { Product } from "./scenes/Product";
import { Cost } from "./scenes/Cost";
import { Proof } from "./scenes/Proof";
import { Close } from "./scenes/Close";

const len = (s: readonly [number, number]) => s[1] - s[0];

// Primary submission film, 90 s.
export const Film: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={SCENES.hook[0]} durationInFrames={len(SCENES.hook)}>
      <Hook len={len(SCENES.hook)} />
    </Sequence>
    <Sequence from={SCENES.concept[0]} durationInFrames={len(SCENES.concept)}>
      <Concept len={len(SCENES.concept)} />
    </Sequence>
    <Sequence from={SCENES.product[0]} durationInFrames={len(SCENES.product)}>
      <Product len={len(SCENES.product)} />
    </Sequence>
    <Sequence from={SCENES.cost[0]} durationInFrames={len(SCENES.cost)}>
      <Cost len={len(SCENES.cost)} />
    </Sequence>
    <Sequence from={SCENES.proof[0]} durationInFrames={len(SCENES.proof)}>
      <Proof len={len(SCENES.proof)} />
    </Sequence>
    <Sequence from={SCENES.close[0]} durationInFrames={len(SCENES.close)}>
      <Close len={len(SCENES.close)} />
    </Sequence>
    {[SCENES.concept[0], SCENES.product[0], SCENES.cost[0], SCENES.proof[0], SCENES.close[0]].map((at) => (
      <SeamWipe key={at} at={at - 12} />
    ))}
  </AbsoluteFill>
);

// Live-judging opener, 18 s: hook, a short product tease, then hand over to the live app.
export const Opener: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={0} durationInFrames={210}>
      <Hook len={210} />
    </Sequence>
    <Sequence from={210} durationInFrames={180}>
      <Product
        len={180}
        startS={13.1}
        zoomAt={9999}
        cues={[{ from: 8, to: 175, text: <>Seams finds where planned projects from two utilities meet.</> }]}
      />
    </Sequence>
    <Sequence from={390} durationInFrames={150}>
      <Close len={150} line="Let's open the live app." />
    </Sequence>
    <SeamWipe at={198} />
    <SeamWipe at={378} />
  </AbsoluteFill>
);
