# Seams product film

Standalone Remotion package for the Seams submission film. It is not part of the web app: it has its own `package.json`, lockfile and `tsconfig.json`, and nothing in the app imports it.

## Compositions

- `SeamsFilm`: primary film, 90 s, 1920x1080, 30 fps.
- `SeamsOpener`: 18 s opener for live judging, then switch to the live app.

## Setup

```bash
cd videos
npm ci
# Optional: use a local headless Chromium instead of letting Remotion download one.
export SEAMS_CHROME=/path/to/chrome-headless-shell
```

`public/footage/prod-walkthrough.mp4` is not in Git. Copy it from Drive `Handoffs/Juan/video/footage/`, or capture again with `scripts/capture.mjs` and `scripts/assemble.py`.

## Commands

```bash
npm run typecheck
npm run compositions
npm run studio           # preview on port 3102
npm run render:draft     # 1280x720
npm run render:final     # 1920x1080
npm run render:opener
node scripts/stills.mjs <outDir> SeamsFilm 225 800 1950   # stills from one bundle
```

## Files

- `src/theme.ts` scene timings and colours. `src/data.ts` frozen numbers (see `CLAIMS.md`).
- `src/parts.tsx` Arc twin, seam wipe, text helpers. `src/scenes/*` one file per scene.
- `BRAND.md`, `BEATS.md`, `CLAIMS.md`, `SOURCES.md`, `STATUS.md`.

All motion is a function of the frame number (`useCurrentFrame`, `interpolate`, `spring`). No timers, clocks or random numbers.

## Web build note

The root Next.js/TypeScript config must exclude `videos/**` before this branch merges, so the app build never needs the film's dependencies. Session 1 owns that change.
