# How to use Seams

Install Node.js, then run `npm install` and `npm run dev`. Open the local address printed by Next.js. The initial map uses Sperry's sample projects and the OpenFreeMap Positron basemap.

The right panel has location search, a date range, a "time overlaps only" toggle, and the ranked overlap list. Click a row, a line, or a marker to open that overlap. The app reads the fixtures in `data/fixtures/` for now. To use the API, change `SOURCE` in `lib/data.ts` to `"api"`.

Run `npm test` for the tests and `npm run lint` for lint.

## Work areas

- `app/` and `components/`: Brent
- `data/` and `scripts/data/`: Alex
- `lib/engine/`: Charles
- `public/brand/`: Juan

Read `AGENTS.md`, `PROGRESS.md`, `DESIGN.md`, and `docs/data-contract.md` before changing shared behavior or data shapes.
