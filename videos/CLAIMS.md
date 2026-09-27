# Claim ledger

Every claim on screen, where it comes from, and how it was checked. Checked 2026-09-27 ~09:28 EDT against production (`https://seams-coral.vercel.app`, deployed from `main` @ `822e7aa`).

| Time | On screen | Source | Check |
|---|---|---|---|
| 0–8 s | "Dominion Energy South Carolina · planned projects", "Georgia Power · planned projects" | `/api/projects` `utility_name` | 5 DESC, 5 GPC projects |
| 0–8 s | "Where their projects come close, who is checking?" | Framing question, not a data claim | n/a |
| 8–20 s | Tier rings 1.6 / 8 / 40 km and what each can share | `DESIGN.md` tiers (Sperry challenge) | Matches app tier labels |
| 8–20 s | "In service within 365 days → time overlap" | `docs/data-contract.md` line 32 | Engine rule; labelled as a stand-in because start dates are missing |
| 8–20 s | Diagram marked "Concept · not to scale" | Drawn, not measured | Positions are illustrative |
| 20–50.7 s | Footage | Headless Chromium screencast of production, 2026-09-27 09:30 EDT | Real app, not a recreation |
| 20–50.7 s | "10 sample projects, 6 cross-utility pairs, ranked by distance" | `/api/projects` (10), `/api/overlaps` (6, rank ascends with distance) | Checked both endpoints |
| 20–50.7 s | Pair #2 details: 9.09 km approx., tier 4, 152 days, in service Jun 1 2026 / Dec 31 2025, Centroid, $17.2K to $30.5K | `/api/overlaps` `OVL_DESC_3_GPC_2`, visible in the app panel | Values read off the captured panel and API |
| 50.7–68 s | $17.2K – $30.5K, P50 $23.4K | `/api/overlaps` cost p10 17231, p50 23365, p90 30485 | Rounded to 0.1K |
| 50.7–68 s | "2,000 seeded draws over ranges from public benchmarks (MISO, ATRI, BLS)" | `lib/engine/cost.ts`, `cost-params.ts` (`DRAWS = 2_000`), `cost-model.md` sections 1 and 4 | Read the code |
| 50.7–68 s | "At tier 4: a share of mobilisation cost, plus shared equipment days" | `TIER_SAVINGS[4]` (mobilisation 5–15%, nothing else) + `tier === 4 ? equipment` | Read the code |
| 50.7–68 s | "Assumes one mile per project" | `COST_PARAMS.projectMiles: 1` | Read the code |
| 50.7–68 s | "Per pair, never summed" | Film rule | No totals shown anywhere |
| 68–81 s | Data: Sperry Tech GridLock sample package, 10 projects, 2 utilities | `source.doc` on every project | Checked |
| 68–81 s | Engine unit tested | `lib/engine/overlap.test.ts`, `components/overlaps.test.ts`, `test/fixtures.test.ts` | Files exist on 822e7aa (tests not re-run in this session) |
| 68–81 s | MongoDB Atlas with local JSON fallback | `app/api/overlaps/route.ts`; live header `x-seams-source: atlas` | Header seen 09:28 EDT |
| 68–81 s | Next.js and MapLibre, live on Vercel | `package.json` (`next`, `maplibre-gl`), production URL | Checked |
| 68–81 s | Not yet: full filings extraction, start dates, exact line routes | `PROGRESS.md` tasks 5–7 todo; `start: null` on all projects; `geometry_quality` substation points | Checked |
| 81–90 s | seams-coral.vercel.app | Production URL | Loads |

## Not claimed on purpose

- Rank 1 pair `OVL_DESC_2_GPC_1` is closest (6.58 km) but in service 3,074 days apart. It is not presented as simultaneous work.
- No real-time operations, no actual savings, no AI decision engine, no custom domain, no voice, no routing, no Jev.
- The film renderer (Remotion) is how the video was made. It is not an app feature.
