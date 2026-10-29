# Data contract

Everyone builds to this. Change it only by PR with all four people agreeing.

Version 2 (2026-10-29): any number of utilities, an optional `synthetic` flag, a `generated` geometry quality, and a second, illustrative dataset. The Sperry sample still fits version 1 unchanged.

## `data/projects.geojson`
GeoJSON FeatureCollection. One Feature per planned project.

- `geometry`: `LineString` when real line geometry is known (OpenStreetMap), otherwise `Point` (substation or midpoint of the two substations). Coordinates are `[longitude, latitude]`.
- `properties`:
  - `id` string, e.g. `DESC_3`, `GPC_12`
  - `utility` short utility code, e.g. `"DESC"`, `"GPC"`, `"LMP"`
  - `utility_name` full name
  - `state` two-letter state code
  - `name` project name as written in the source
  - `type` `"line"` | `"substation"` | `"rebuild"` | `"reconductor"` | `"other"`
  - `voltage_kv` number or null
  - `in_service` ISO date `YYYY-MM-DD`
  - `start` ISO date or null
  - `endpoints` array of `{ "name": string, "coordinates": [lon, lat] | null }`
  - `geometry_quality` `"osm_line"` (exact) | `"substation_midpoint"` | `"single_substation"` (both shown as "Centroid") | `"generated"` (made up, shown as "Illustrative")
  - `confidence` 0 to 1
  - `source` `{ "doc": string, "page": number | null, "url": string | null }`
  - `synthetic` optional, `true` for made-up projects in the illustrative dataset

## `data/overlaps.json`
Array, sorted by `rank`.

- `id` string, `rank` number (1 = top)
- `a`, `b` project ids from two different utilities, `a` having the lower utility code
- `distance_km` closest distance between the two geometries
- `tier` 1 touching, 2 under 1.6 km, 3 under 8 km, 4 under 40 km
- `time_gap_days` days between in-service dates
- `time_overlap` true if the build windows overlap when both projects have a `start` date, otherwise true if the in-service dates are within 365 days
- `closest_points` `[[lon, lat], [lon, lat]]`
- `approximate` true unless both sides are `osm_line`
- `cost` `{ "p10": number, "p50": number, "p90": number, "currency": "USD", "trucks_saved": number, "co2_t": number }` or null

Ranking: tier first (1 before 4), then distance, then time overlap first.

## Utilities

`UtilityInfo`: `{ "code": string, "name": string, "states": string[], "fictional": boolean }`. The sample's two utilities are built into `lib/data.ts`; the illustrative dataset ships its own `utilities.json`.

## Illustrative dataset

`public/data/illustrative/projects.geojson`, `overlaps.json` and `utilities.json`, made by `npm run generate:illustrative` (`scripts/generate-illustrative.ts`). Same shapes as above. About 800 projects from 23 utilities: the 10 real Sperry sample projects under DESC and GPC, plus made-up projects from 21 invented utilities, placed on real US towns from `scripts/data/us-cities-top-1k.csv`. Every made-up project has `synthetic: true` and `geometry_quality: "generated"`. These are static files served by Next.js, not MongoDB Atlas; Atlas keeps serving the sample. The same seed always gives the same output. The UI always labels this dataset "Illustrative data".

## Fixtures
`data/fixtures/projects.geojson` and `data/fixtures/overlaps.json` hold Sperry's 10 sample projects and 6 overlaps in this shape. Distances were recomputed with haversine between the points Sperry used and match Sperry's sheet (`distance_mi`, converted to km) to within 0.01 km. Each overlap also keeps `sperry_distance_km` for the test.
