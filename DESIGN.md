# DESIGN.md

Status: brand is final (confirmed by Juan, 2026-09-27). Logo, Arc and the Utility Navy palette below are the approved versions.
Keep building with theme variables; components never hard-code colours.

## Logo (final)
All files are pure vector paths (no fonts, no raster) in `public/brand/`:
- `logo-full-light.svg`: Arc mark #F5BC42 + "seams" wordmark #0F1B2D, for light backgrounds. viewBox 0 0 1111 451.
- `logo-full-dark.svg`: same, wordmark #E8EEF7, for dark backgrounds.
- `logo-mark-only.svg`: Arc mark alone, eyes are transparent cut-outs. Also the favicon (`app/icon.svg`).
- Clear space: at least the height of the "s" on every side. Minimum size: 24 px tall in UI, 16 px as favicon.
- Mark is always Arc gold #F5BC42; wordmark uses `--text`. Monochrome: one solid colour for the whole logo. No gradients, outlines or a mouth. Arc sits beside the logo, never inside or behind it.
- Figma: "Brand and UI" file, page 02-Logo, component set "Logo" (Full light, Full dark, Mark). Brand guide slides 01 and 10.

## Layout (from Juan's wireframe)
Two panes, full screen:

- **Left, about 70%: map.** Flat 2D map of the US on load. Project markers for both utilities. When an overlap is selected, the map zooms to that area and draws a line between the two projects' closest points.
- **Right, about 30%: sidebar** (retractable). Top to bottom:
  1. **Location search** (text field). Typing a place moves the map there.
  2. **Filter row, three controls:** date range start, date range end, and a toggle "time overlaps only".
  3. **Ranked list of overlaps.** Each row: `GPC -> DESC` style utility pair, project names, distance, a clock icon if the build windows overlap, and an info icon.
  4. **Selected row expands in place** to show details: both project names and utilities, closest distance, tier, time gap in days, in-service dates, location accuracy (**Exact** or **Centroid**), sources, and the cost-of-not-coordinating range.
- **Mascot:** small, bottom-left corner of the map. Reacts to what the user does (see Mascot below).
- A future "project table" view (Location, In-service date) is in the notes; not required tonight.

## Overlap tiers (from the Sperry challenge, fixed)
1. Touching or crossing: must coordinate outage timing and crossing structures
2. Under 1.6 km: can share land (right-of-way, access roads, permits)
3. Under 8 km: can share site logistics (laydown yards, deliveries)
4. Under 40 km: can share crews and equipment

Tier colour: a 4-step scale from most severe (tier 1) to least (tier 4). Use theme tokens `--tier-1` to `--tier-4`.

## Theme tokens (final values live in `app/theme.css`)
- Theme follows the device setting until the user picks one with the header toggle. The choice is saved in the browser (`localStorage` key `seams-theme`) and set as `data-theme` on `<html>`.
- `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--tier-1..4`, `--utility-a`, `--utility-b`
- Font: Afacad (body, loaded with `next/font`, variable `--font-afacad`), falling back to the system UI stack. Numbers in a monospace font.
- Radius, spacing: 4 / 8 / 12 / 16 / 24.

## Mascot (final: Arc v3)
Working name: **Arc**. A lightning bolt with a face. One solid colour, no gradients.
Web component (Arc v3): `public/brand/arc-mascot.js`, `<arc-mascot size="96" color="var(--text)">`.
Reactions to wire in the app:
- app loads: `idle`
- user searches or filters: `thinking` while the list updates, then `idle`
- user selects an overlap: tier 1 or 2 `alert`, tier 3 or 4 `found`
- selected pair also overlaps in time: `wide`
- data fails to load: `error`
- nothing matches the filters: `confused`
- idle for 60 s: `sleep`
Keep calls to `play(name)` so the art can be updated without touching the app.
- Colour: people can pick any colour for Arc on the settings page (`/settings`): theme-colour swatches or the browser's colour picker (the system colour wheel on a Mac), with Back to gold. The map corner shows a "Customize Arc" link there. The choice is saved in the browser (`seams.arc-color`) and applies everywhere Arc shows. The default lives in `app/theme.css` as `--arc-brand`. The logo mark stays gold.
- Accessories: Arc can wear a hard hat, a headlamp or a party hat, picked on the settings page. Saved in the browser (`seams.arc-accessory`) and shown everywhere Arc shows, including the loading screen. The drawings live in `components/arcAccessories.ts` and are added to Arc's moving group (`g.all` in `arc-mascot.js`), so they follow every pose. Their colours are the `--arc-hat`, `--arc-gear`, `--arc-lamp` and `--arc-party` tokens in `app/theme.css`.

## Desktop shell (2026-09-27)
- Header: merged logo (`public/brand/logo-full-light.svg` / `logo-full-dark.svg`), tagline, a light/dark toggle, and a Menu (Explore overlaps, How it works, Data and methodology, Reset demo). Favicon is `app/icon.svg` (the Arc mark).
- Map opens framed on the project bounds, not the continent. Bottom toolbar: Overview, Focus selected, Reset view.
- Selecting a pair dims the other markers and lines and labels both projects on the map.
- States: loading pill over the map, API error with Try again, tile failure notice (the list still works), empty result that names the filter that hid everything.
- Details: "schedule match" only means in-service dates within 365 days. Cost shown as P10 to P90 with the median, labelled as a model estimate.
- Coordination brief: Copy or Download .md. Client-side only; nothing is sent or saved.

## Arc reactions (as wired)
- data loading: `thinking`; loaded: `happy`, then `idle`
- filters change: `thinking`, then `idle`, or `confused` when nothing matches
- open a pair: `alert` if it is a schedule match or tier 1 or 2, otherwise `found`
- data fails: `error`; Try again goes back to `thinking`
- 60 s without input: `sleep`; any input wakes it
- If the Arc script fails or takes over 8 s, Arc is hidden and the app keeps working.

## Datasets and the big map (2026-10-29)
- Two datasets, picked at the top of the panel: **Illustrative** (default, about 3,400 made-up projects from 33 utilities on real US towns) and **Sperry sample** (the 10 real projects). Saved in the browser as `seams.dataset` (`lib/dataset.ts`).
- The illustrative dataset is always labelled: "Illustrative data" chip under the toggle, a line in the legend, the Data and methodology drawer, and coordination briefs. Accuracy shows "Illustrative".
- Projects draw on the GPU (MapLibre symbol layers with SDF shapes from `components/mapShapes.ts`), same shapes as before. With two utilities they keep the DESC/GPC colours. With many, every project is `--muted` and only the two sides of the open pair get `--utility-b` (first) and `--utility-a` (second), matching the list.
- No aggregation shapes: the zoomed-out map shows every project and every seam line, thinner and smaller on the big dataset (Juan, 2026-10-29: hexagons and light columns are out).
- The list shows 100 rows at a time with "Show more".
- The panel content lives in `components/Sidebar.tsx`, so the desktop sidebar and a phone sheet can both render it.

## Settings page (2026-10-29)
- `/settings`, from the Menu or the "Customize Arc" link. Live Arc preview with reaction buttons, then cards: Arc's colour, Arc's accessory, Theme (Device, Light, Dark), Distances (km or miles), Motion (Follow device or Reduce), Data the map opens with.
- Keys: `seams.arc-color`, `seams.arc-accessory`, `seams-theme` (removed for Device), `seams.units`, `seams.motion`, `seams.dataset`. All in `components/settings.ts`, `components/ArcColorPicker.tsx`, `components/arcAccessories.ts`, `lib/dataset.ts`.
- Reduce motion sets `data-motion="reduce"` on `<html>` before paint and cuts CSS animation; `prefersReducedMotion()` covers the JS animation.
- No decorative dot grid on the loading screen any more.

## Map view: 2D and 3D (2026-10-29)
- Switch at the top right of the map (and on `/settings`): **2D**, **3D time**, **3D utility**. Saved as `seams.map-view`. The idea comes from the Tokyo Last Train Atlas reference in the vault: height carries a second dimension.
- 3D tilts the camera (pitch 55, bearing -18). Each project is a thin ribbon at its height in the project colour; when zoomed in, line projects also get a see-through curtain to the ground. Seams stay as tier-coloured lines on the ground. The open pair gets one thin stitch in its tier colour from the lower ribbon to the higher.
- 3D time: height is the in-service date, earliest at the bottom, with a year bar (drag or play) that ghosts projects not in service yet. 3D utility: one floor per utility. A caption under the switch says what height means.
- Juan, 2026-10-29: no per-utility rainbow colours, station nodes or wall-sized stitches (too messy). No light columns, no aggregation shapes.

## Keeping the big map readable (2026-10-29, after Common Ground)
- **Scope** picker above the legend: United States or one state. A pair is in scope when either project is in the state; the map shows in-scope projects plus their partners and flies there.
- **Focus on open**: with a pair open, 3D draws only that pair; 2D fades everything else to 15%.
- **Zoomed out on the big dataset**: only tier 1 and 2 seams show until zoom 5 to 6.5; project lines sit back at 22%.
- **Focus while zooming** (Juan, 2026-10-29): from zoom 7.5 with no pair open, the 16 seams nearest the middle of the screen (within a third of the shorter side) light up with their projects in `--utility-a`; everything else fades to 10%. Done with MapLibre feature state on camera stop, so moving never rebuilds data.
- **List follows the map**: from zoom 5.5 the list shows only pairs whose seam is on screen ("In view N of M", with Show all). The open pair always stays in the list.
- Geometry and heights: `components/map3d.ts`. Heights scale with zoom (450 km of full height at zoom 3 down to 300 m at zoom 14).

## Exploring the list (2026-10-29, handoff C)
- Above the list: Sort (Severity, Soonest build, Closest in time, Biggest savings, Closest distance; `#rank` stays the severity rank), Group (Tier, Year, Utility pair, State; collapsible, paged per group), and List or Timeline.
- Timeline (`components/TimelineView.tsx`): each pair's two build windows on one year axis in the side colours; shaded when both are being built. Projects without a start date show the year before in service, faded.
- Savings line: "Coordinating these could save $X to $Y across N pairs, each project counted once" (`honestSavings` in `components/explore.ts`). Never adds ranges of pairs that share a project.
- Spotlight (under the filters): one utility. List and map keep only its pairs, its projects take `--accent`, and a box ranks the utilities it collides with most.
- Years button (next to the view switch) opens the year bar in 2D and 3D utility; 3D time always has it. The list keeps pairs where both projects are in service by the year; later seams fade on the map.

## Sharing and Arc (2026-10-29, handoff D)
- **Deep links** (`lib/urlState.ts`): the address holds dataset, open pair, dates, time-only, scope, spotlight, map view, year and camera. Opening a pair adds a history entry, so Back closes it. "Copy link" sits with the brief buttons. Unknown pair ids are ignored and Arc says so. Only ids, dates and the camera go in the URL.
- **Command palette** (`components/CommandPalette.tsx`): Cmd or Ctrl + K, or the search buttons (panel header, phone peek strip). Finds pairs (`#12`), projects, utilities (spotlight), states (scope) and actions.
- **Coordination plan** (`lib/plan.ts`, `components/PlanTray.tsx`, `/plan`): "Add to plan" on a pair; a Plan pill with the count opens a tray to reorder, remove, download Markdown, or open the printable page (SVG sketch per pair, facts, per-pair cost range, never a total). Saved in the browser only.
- **Arc narrates** each opened pair from the numbers only (`components/narrate.ts`): where, when, which projects, what they could share.
- **Easter eggs**: a borrowed hard hat for a few seconds on tier 1 pairs (never saved, his own accessory wins), a cheer on the first tier 1 of a visit, and a dance for the Konami code or typing "arc" in the palette. Calm with reduced motion.

## Phones (2026-10-29)
- Below 768 px: full-screen map with a draggable bottom sheet (`components/BottomSheet.tsx`): peek (124 px: count or the open pair, plus Overview or Close), half, full. Drag or tap the handle; a quick flick moves one stop. Only the handle drags, so the list scrolls normally.
- Opening a pair from the list or the map drops the sheet to peek and frames the pair above it.
- Top row: compact Scope picker, a "Legend" button that opens the legend, and the view switch with short labels. No zoom buttons (pinch). Arc is 56 px and sits above the sheet; the year bar sits above the sheet at peek.
- 768 px and up keeps the desktop sidebar (42% wide on tablets, 30% from 1024 px).

## Rules
- Never show a cost as one exact number; show a range.
- Always label approximate distances ("Centroid" accuracy).
- No chat window as the core experience.
