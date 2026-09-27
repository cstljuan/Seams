# Film brand notes

Source: Session 1 brand snapshot `v1-822e7aa` (`Handoffs/Juan/brand/film-handoff/snapshots/v1-822e7aa/`), copied into `public/brand/` and checked with `sha256sum -c SHA256SUMS` (all OK). The film never reads the Drive folder at render time.

- **Background:** Utility Navy dark `--bg #0b1422`. Text `#e8eef7`, muted `#8a9ab0`.
- **Utilities:** DESC `#b8c7ff` (`--utility-a` dark), GPC `#3ddcb4` (`--utility-b` dark). These are the two seam lines.
- **Arc:** `#f5bc42` only. Used for the meeting point, key qualifiers and the Arc mark. Tier colours stay separate (tier 4 `#6ea8ff` for the cost bar and diagram link).
- **Arc twin:** `src/parts.tsx` draws the idle mark path from `logo-mark-only.svg` (one colour, two cut-out eyes, no mouth, no gradient). Motion is a slow squash/stretch under 3%, driven by the frame number. The live app's `<arc-mascot>` appears only inside real footage.
- **Logo:** `logo-full-dark.svg` on the closing frame. Snapshot marks it "provisional, Juan to confirm".
- **Type:** Afacad (SIL OFL 1.1, pinned at `public/fonts/Afacad-wght.ttf`) for all film text; DejaVu Sans Mono (system) for numbers. Afacad Flux and IBM Plex Mono are not used (not approved).
- **Motif:** two lines approach, reveal the gap, and meet. Every scene cut is that meeting (`SeamWipe`). No glitch, particles or neon.
