// Location search proxy for Nominatim (OpenStreetMap).
// Browsers cannot set a User-Agent, so we call Nominatim from here, one request per second at most.
const NOMINATIM = "https://nominatim.openstreetmap.org/search?format=json&q=";
const USER_AGENT = "Seams/0.1 (ShellHacks 2026; https://github.com/cstljuan/Shellhacks-2026)";
const MIN_GAP_MS = 1000;

let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const cache = new Map<string, unknown>();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string]; // south, north, west, east
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 200) return Response.json([]);

  const key = q.toLowerCase();
  if (cache.has(key)) return Response.json(cache.get(key));

  try {
    const results = await throttled(async () => {
      const res = await fetch(`${NOMINATIM}${encodeURIComponent(q)}&countrycodes=us&limit=5`, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
      return (await res.json()) as NominatimResult[];
    });
    const places = results.map((r) => {
      const [s, n, w, e] = (r.boundingbox ?? []).map(Number);
      return {
        name: r.display_name,
        center: [Number(r.lon), Number(r.lat)],
        bbox: r.boundingbox ? [w, s, e, n] : undefined,
      };
    });
    if (cache.size > 200) cache.clear();
    cache.set(key, places);
    return Response.json(places);
  } catch {
    return Response.json({ error: "Location search is unavailable" }, { status: 502 });
  }
}
