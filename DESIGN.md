# DESIGN.md (DRAFT, not final)

Status: the brand guide is being redesigned. Logo, mascot and colour palette are NOT final.
Build with theme variables so the final brand can be dropped in without touching components.

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

Tier colour: a 4-step scale from most severe (tier 1) to least (tier 4). Final colours TBD with the brand. Use theme tokens `--tier-1` to `--tier-4`.

## Theme tokens (placeholder values, will change)
- `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--tier-1..4`, `--utility-a`, `--utility-b`
- Font: system UI stack for now. Numbers in a monospace font.
- Radius, spacing: 4 / 8 / 12 / 16 / 24.

## Mascot (placeholder)
Working name: **Arc**. A lightning bolt with a face. One solid colour, no gradients.
Placeholder web component: `brand/arc-mascot.js`, `<arc-mascot size="96" color="var(--text)">`.
Reactions to wire in the app:
- app loads: `idle`
- user searches or filters: `thinking` while the list updates, then `idle`
- user selects an overlap: tier 1 or 2 `alert`, tier 3 or 4 `found`
- selected pair also overlaps in time: `wide`
- data fails to load: `error`
- nothing matches the filters: `confused`
- idle for 60 s: `sleep`
The final mascot art may change; keep calls to `play(name)` so the art can be swapped.

## Rules
- Never show a cost as one exact number; show a range.
- Always label approximate distances ("Centroid" accuracy).
- No chat window as the core experience.
