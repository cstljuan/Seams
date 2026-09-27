# Data contract

Everyone builds to this. Change it only by PR with all four people agreeing.

## `data/projects.geojson`
GeoJSON FeatureCollection. One Feature per planned project.

- `geometry`: `LineString` when real line geometry is known (OpenStreetMap), otherwise `Point` (substation or midpoint of the two substations). Coordinates are `[longitude, latitude]`.
- `properties`:
  - `id` string, e.g. `DESC_3`, `GPC_12`
  - `utility` `"DESC"` or `"GPC"`
  - `utility_name` full name
  - `state` `"SC"` or `"GA"`
  - `name` project name as written in the source
  - `type` `"line"` | `"substation"` | `"rebuild"` | `"reconductor"` | `"other"`
  - `voltage_kv` number or null
  - `in_service` ISO date `YYYY-MM-DD`
  - `start` ISO date or null
  - `endpoints` array of `{ "name": string, "coordinates": [lon, lat] | null }`
  - `geometry_quality` `"osm_line"` (exact) | `"substation_midpoint"` | `"single_substation"` (both shown as "Centroid")
  - `confidence` 0 to 1
  - `source` `{ "doc": string, "page": number | null, "url": string | null }`

## `data/overlaps.json`
Array, sorted by `rank`.

- `id` string, `rank` number (1 = top)
- `a`, `b` project ids (one DESC, one GPC)
- `distance_km` closest distance between the two geometries
- `tier` 1 touching, 2 under 1.6 km, 3 under 8 km, 4 under 40 km
- `time_gap_days` days between in-service dates
- `time_overlap` true if the build windows overlap (rule for now: in-service dates within 365 days; replace when start dates exist)
- `closest_points` `[[lon, lat], [lon, lat]]`
- `approximate` true unless both sides are `osm_line`
- `cost` `{ "p10": number, "p50": number, "p90": number, "currency": "USD", "trucks_saved": number, "co2_t": number }` or null

Ranking: tier first (1 before 4), then distance, then time overlap first.

## Fixtures
`data/fixtures/projects.geojson` and `data/fixtures/overlaps.json` hold Sperry's 10 sample projects and 6 overlaps in this shape. Distances were recomputed with haversine between the points Sperry used and match Sperry's sheet (`distance_mi`, converted to km) to within 0.01 km. Each overlap also keeps `sperry_distance_km` for the test.
