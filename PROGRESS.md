# PROGRESS.md

Update your row when you start (in progress) and finish (done, with PR link).

| # | Task | Owner | Status | Blocked by | PR |
|---|---|---|---|---|---|
| 1 | Repo foundation: Next.js app shell, docs, fixtures, test setup | Juan | done via #4 (turf, mongodb, .env.example, READMEs to follow) | | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 2 | Brand guide v2 (logo, mascot, palette) | Juan | todo | | |
| 3 | Figma wireframes from the paper sketch | Juan | todo | | |
| 4 | Sample data in contract shape (10 projects, 6 overlaps) | Juan | done (in fixtures) | | |
| 5 | Extract DESC + GPC projects from the two PDFs | Alex | todo | | |
| 6 | Geocode substations (Overpass), line geometry where found | Alex | todo | 5 | |
| 7 | `data/projects.geojson` real data | Alex | todo | 6 | |
| 8 | MongoDB Atlas cluster + seed script | Alex | todo | 7 | |
| 9 | Overlap engine: closest distance, tier, time overlap, ranking + tests | Charles | todo | | |
| 10 | Cost model + range (P10/P50/P90) | Charles | todo | | |
| 11 | Build `data/overlaps.json` from projects; `/api/overlaps` (Mongo, JSON fallback) | Charles | todo | 9 | |
| 12 | Map with both utilities, markers by type, overlap lines by tier | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 13 | Sidebar: search, date range, time-only toggle, ranked list, expandable row | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 14 | Select overlap: zoom map, draw line, show details | Brent | done (on fixtures; API swap is next) | 12, 13 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 15 | Mascot component in the corner, wired to reactions | Brent | done (on fixtures; API swap is next) | 1 | [#4](https://github.com/cstljuan/Seams/pull/4) |
| 16 | Deploy + free GoDaddy domain | Juan | todo | 1 | |
| 17 | Pitch script (3 min + 5 min) | Juan, Charles | todo | | |
| 18 | Demo video | Juan | todo | 14 | |

## Checkpoints (tonight)
- 20:00 deployed app shows the 10 sample projects and 6 overlaps, ranked
- 23:00 real extracted data in
- 02:00 feature freeze, polish only
- 09:00 video rendered
- 10:30 submit (Devpost not open yet; watch Discord)

## On hold (only if everything above is done)
Jev decision card, Waymo truck routing, ElevenLabs voice, Gemini brief, 3D tilt.
