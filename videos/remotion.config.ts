import { Config } from "@remotion/cli/config";

// Frames are written as JPEG, then encoded as H.264.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setConcurrency(1);
Config.setChromiumOpenGlRenderer("swiftshader");
// Optional local browser, so a render does not need to download one.
if (process.env.SEAMS_CHROME) {
  Config.setBrowserExecutable(process.env.SEAMS_CHROME);
}
