// Frozen values from the live production API, fetched 2026-09-27 ~09:28 EDT
// (https://seams-coral.vercel.app/api/overlaps, header x-seams-source: atlas).
// See ../CLAIMS.md. Change these only after re-checking the API.
export const PAIR = {
  id: "OVL_DESC_3_GPC_2",
  rank: 2,
  gpc: "SAV: McIntosh – Purrysburg 230 kV reactors",
  desc: "Jasper – Okatie 230 kV #2: construct",
  distanceKm: "9.09",
  tier: 4,
  tierLabel: "Under 40 km: can share crews and equipment",
  gapDays: 152,
  gpcInService: "Jun 1, 2026",
  descInService: "Dec 31, 2025",
  p10: 17231,
  p50: 23365,
  p90: 30485,
};

export const COUNTS = { projects: 10, overlaps: 6 };
export const LIVE_URL = "seams-coral.vercel.app";
export const CAPTURED = "captured 27 Sep 2026";
