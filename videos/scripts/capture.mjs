// Capture the production app with a CDP screencast. Needs Playwright (not a package dependency):
//   PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/capture.mjs <outDir>
// Then build the clip with scripts/assemble.py.
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
import fs from 'fs';
const OUT = process.argv[2]; fs.mkdirSync(OUT + '/frames', { recursive: true });
const t0 = Date.now(); const log = []; const mark = (m) => { log.push({ t: (Date.now() - t0) / 1000, m }); console.log(((Date.now()-t0)/1000).toFixed(2), m); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  const i = frames.length; const file = `${OUT}/frames/f${String(i).padStart(5, '0')}.jpg`;
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, t: (Date.now() - t0) / 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
mark('goto');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1600, maxHeight: 900 });
await page.goto('https://seams-coral.vercel.app/', { waitUntil: 'networkidle', timeout: 60000 });
mark('loaded');
await page.waitForTimeout(6000);
await page.screenshot({ path: OUT + '/s1-overview.png' }); mark('overview');
const sw = page.locator('button[role="switch"]');
await sw.hover(); await page.waitForTimeout(800);
await sw.click(); mark('timeonly-on');
await page.waitForTimeout(3500);
await page.screenshot({ path: OUT + '/s2-filtered.png' });
const row = page.locator('button[aria-controls="OVL_DESC_3_GPC_2-details"]');
await row.hover(); await page.waitForTimeout(900);
await row.click(); mark('select-OVL_DESC_3_GPC_2');
await page.waitForTimeout(7000);
await page.screenshot({ path: OUT + '/s3-selected.png' }); mark('selected-settled');
const det = page.locator('#OVL_DESC_3_GPC_2-details');
await det.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
const box = await det.boundingBox(); mark('details-box ' + JSON.stringify(box));
if (box) { for (let k = 0; k < 6; k++) { await page.mouse.move(box.x + 40, box.y + 20 + k * box.height / 6, { steps: 12 }); await page.waitForTimeout(700); } }
await page.screenshot({ path: OUT + '/s4-details.png', fullPage: false }); mark('details');
await page.waitForTimeout(3000);
await cdp.send('Page.stopScreencast'); mark('end');
fs.writeFileSync(OUT + '/log.json', JSON.stringify({ url: 'https://seams-coral.vercel.app/', started: new Date(t0).toISOString(), log, frames }, null, 1));
await browser.close();
