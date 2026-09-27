# Film status (Session 2)

Updated 2026-09-27 ~10:05 EDT.

- Branch `cstljuan/product-film`, base `822e7aaefda34b473f609aff008ac20e76241284` (origin/main). Local only, not pushed.
- Footage: production https://seams-coral.vercel.app, captured 2026-09-27 09:29 EDT (13:29:25 UTC), headless Chromium screencast 1600x900. Not the Session 1 candidate UI (`95c568e`, frozen 09:42, not deployed).
- Brand: snapshot v1-822e7aa (hash-checked). Snapshot v2-95c568e exists (Afacad in app, favicon); logos and Arc unchanged, so the film does not need it.
- Renders (Drive `Handoffs/Juan/video/renders/`): r1 at a08809f (loading skeleton for ~0.5 s at 0:20, kept as fallback), r2 at 4fc6996 (current candidate).
- Film is **candidate-ready, not publication-ready**: it shows production as of 09:29. If the desktop-experience UI is merged and deployed before upload, the film shows the old UI. Claims stay true, but re-check `CLAIMS.md` against the deployed build before upload.
- Silent, captioned. No music, no voice. Narration script in `BEATS.md` if Juan records one.

## Open

- Root Next.js/TypeScript must exclude `videos/**` before merge (Session 1 owns it).
- Higher-quality render on a faster machine: prompt in Drive `Handoffs/Juan/video/RENDER-ON-FASTER-MACHINE-PROMPT.md`.
