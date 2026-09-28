# PROGRESS.md

Update your row when you start (in progress) and finish (done, with PR link).

| # | Task | Owner | Status | Blocked by | PR |
|---|---|---|---|---|---|
| 1 | Repo foundation: Next.js app shell, docs, fixtures, test setup | Juan | done | | [#4](https://github.com/cstljuan/Seams/pull/4), [#5](https://github.com/cstljuan/Seams/pull/5), [#6](https://github.com/cstljuan/Seams/pull/6) |
| 2 | Brand guide v2 (logo, mascot, palette) | Juan | in progress: Arc v3 on `cstljuan/arc-v3`, Utility Navy light + dark on `cstljuan/theme-navy` | | |
| 3 | Figma wireframes from the paper sketch | Juan | todo | | |
| 4 | Sample data in contract shape (10 projects, 6 overlaps) | Juan | done (in fixtures) | | |
| 5 | Extract DESC + GPC projects from the two PDFs | Alex | todo | | |
| 6 | Geocode substations (Overpass), line geometry where found | Alex | todo | 5 | |
| 7 | `data/projects.geojson` real data | Alex | todo | 6 | |
| 8 | MongoDB Atlas cluster + seed script | Alex | todo | 7 | |
| 9 | Overlap engine: closest distance, tier, time overlap, ranking + tests | Charles | in progress | | |
| 10 | Cost model + range (P10/P50/P90) | Charles | in progress | | |
| 11 | Build `data/overlaps.json` from projects; `/api/overlaps` (Mongo, JSON fallback) | Charles | in progress | 9 | |
| 12 | Map with both utilities, markers by type, overlap lines by tier | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 13 | Sidebar: search, date range, time-only toggle, ranked list, expandable row | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 14 | Select overlap: zoom map, draw line, show details | Brent | done (on fixtures; API swap is next) | 12, 13 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 15 | Mascot component in the corner, wired to reactions | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 16 | Deploy + free GoDaddy domain | Juan | in progress: main build fixed on `cstljuan/fix-main-build`, Vercel next | | |
| 17 | Pitch script (3 min + 5 min) | Juan, Charles | todo | | |
| 18 | Demo video | Juan | todo | 14 | |
| 19 | Desktop experience: framed map, menu, methodology, states, Arc wiring, coordination brief | Juan (Session 1) | done on `cstljuan/desktop-experience`, not pushed | | |
| 20 | Arc colour picker on the loading screen | Brent | done | | |
| 21 | Light/dark toggle in the sidebar header (saved per browser) | Brent | done | | |

## Checkpoints (tonight)
- 20:00 deployed app shows the 10 sample projects and 6 overlaps, ranked
- 23:00 real extracted data in
- 02:00 feature freeze, polish only
- 09:00 video rendered
- 10:30 submit (Devpost not open yet; watch Discord)

## On hold (only if everything above is done)
Jev decision card, Waymo truck routing, ElevenLabs voice, Gemini brief, 3D tilt.
