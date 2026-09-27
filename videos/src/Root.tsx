import React from "react";
import { Composition } from "remotion";
import "./fonts";
import { Film, Opener } from "./Film";
import { FPS, H, W } from "./theme";

export const Root: React.FC = () => (
  <>
    <Composition id="SeamsFilm" component={Film} durationInFrames={2700} fps={FPS} width={W} height={H} />
    <Composition id="SeamsOpener" component={Opener} durationInFrames={540} fps={FPS} width={W} height={H} />
  </>
);
