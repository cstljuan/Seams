// Render stills from one bundle. Usage: node scripts/stills.mjs <outDir> <comp> <frame...>
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition, openBrowser } from "@remotion/renderer";
import path from "node:path";

const [outDir, comp, ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const browser = await openBrowser("chrome", {
  browserExecutable: process.env.SEAMS_CHROME ?? null,
  chromiumOptions: { gl: "swiftshader" },
});
const composition = await selectComposition({ serveUrl, id: comp, puppeteerInstance: browser });
for (const f of frames) {
  const output = path.join(outDir, `${comp}-${String(f).padStart(4, "0")}.jpg`);
  await renderStill({ serveUrl, composition, frame: Number(f), output, imageFormat: "jpeg", jpegQuality: 88, puppeteerInstance: browser });
  console.log(output);
}
await browser.close({ silent: true });
