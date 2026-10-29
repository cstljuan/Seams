// The coordination plan: pairs someone has picked to work through together. Saved in this browser only.
const KEY = "seams.plan";
const MAX = 50;

let memory: string[] = [];
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, MAX) : [];
  } catch {
    cache = memory;
  }
  return cache;
}

function write(ids: string[]) {
  const next = [...new Set(ids)].slice(0, MAX);
  memory = next;
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage off: the plan still holds for this visit.
  }
  listeners.forEach((fn) => fn());
}

const EMPTY: string[] = [];

export const plan = {
  get: (): string[] => (typeof window === "undefined" ? EMPTY : read()),
  has: (id: string) => read().includes(id),
  toggle: (id: string) => write(read().includes(id) ? read().filter((x) => x !== id) : [...read(), id]),
  remove: (id: string) => write(read().filter((x) => x !== id)),
  move: (id: string, by: -1 | 1) => {
    const ids = [...read()];
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    write(ids);
  },
  clear: () => write([]),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  serverSnapshot: () => EMPTY,
};
