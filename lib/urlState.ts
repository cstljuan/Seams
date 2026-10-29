// Shareable links: the URL holds what is on screen, so a link opens the same pair and view.
// Only ids, dates and the camera go in the URL. Nothing personal.
// Add a key here and in both functions; reserved for later: "sort", "group".
import type { Dataset } from "./dataset";

export interface UrlState {
  dataset?: Dataset;
  pair?: string;
  from?: string;
  to?: string;
  timeOnly?: boolean;
  scope?: string;
  spotlight?: string;
  mapView?: "flat" | "time" | "utility";
  year?: number;
  // [longitude, latitude, zoom]
  view?: [number, number, number];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z]{2,5}$/;
const ID = /^[A-Za-z0-9_]{1,80}$/;

export function parseUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const out: UrlState = {};
  const d = q.get("d");
  if (d === "illustrative" || d === "sample") out.dataset = d;
  const pair = q.get("pair");
  if (pair && ID.test(pair)) out.pair = pair;
  const from = q.get("from");
  if (from && DATE.test(from)) out.from = from;
  const to = q.get("to");
  if (to && DATE.test(to)) out.to = to;
  if (q.get("t") === "1") out.timeOnly = true;
  const scope = q.get("s");
  if (scope && CODE.test(scope)) out.scope = scope;
  const u = q.get("u");
  if (u && CODE.test(u)) out.spotlight = u;
  const mv = q.get("mv");
  if (mv === "flat" || mv === "time" || mv === "utility") out.mapView = mv;
  const y = Number(q.get("y"));
  if (Number.isInteger(y) && y >= 1990 && y <= 2100) out.year = y;
  const view = q.get("view")?.split(",").map(Number);
  if (view?.length === 3 && view.every(Number.isFinite) && Math.abs(view[0]) <= 180 && Math.abs(view[1]) <= 85 && view[2] >= 0 && view[2] <= 22) {
    out.view = [view[0], view[1], view[2]];
  }
  return out;
}

export function buildUrlState(s: UrlState): string {
  const q = new URLSearchParams();
  if (s.dataset) q.set("d", s.dataset);
  if (s.pair) q.set("pair", s.pair);
  if (s.from) q.set("from", s.from);
  if (s.to) q.set("to", s.to);
  if (s.timeOnly) q.set("t", "1");
  if (s.scope) q.set("s", s.scope);
  if (s.spotlight) q.set("u", s.spotlight);
  if (s.mapView && s.mapView !== "flat") q.set("mv", s.mapView);
  if (s.year !== undefined) q.set("y", String(s.year));
  if (s.view) q.set("view", `${s.view[0].toFixed(4)},${s.view[1].toFixed(4)},${s.view[2].toFixed(2)}`);
  const out = q.toString();
  return out ? `?${out}` : "";
}
