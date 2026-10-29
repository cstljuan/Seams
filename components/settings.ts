"use client";

import { useSyncExternalStore } from "react";
import { savedChoice } from "./savedChoice";

// Choices from the settings page (/settings). Each is saved in the browser only.

// Distance units for every distance shown in the app.
export type Units = "km" | "mi";
export const unitsChoice = savedChoice("seams.units", (v) => v === "km" || v === "mi");
export const getUnits = (): Units => (unitsChoice.get() as Units | null) ?? "km";
export function useUnits(): Units {
  return (useSyncExternalStore(unitsChoice.subscribe, unitsChoice.get, () => null) as Units | null) ?? "km";
}

const MI_PER_KM = 0.621371;
export function formatDistance(km: number, units: Units = getUnits()): string {
  return units === "mi" ? `${(km * MI_PER_KM).toFixed(2)} mi` : `${km.toFixed(2)} km`;
}

// Motion: follow the device, or always reduce. Set as data-motion on <html> (app/layout.tsx does it before paint).
export type Motion = "system" | "reduce";
export const MOTION_KEY = "seams.motion";
export const motionChoice = savedChoice(MOTION_KEY, (v) => v === "reduce");

export function applyMotion(motion: Motion) {
  if (motion === "reduce") document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}

function deviceReduces(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function subscribeMotion(fn: () => void) {
  const off = motionChoice.subscribe(fn);
  const m = matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", fn);
  return () => {
    off();
    m.removeEventListener("change", fn);
  };
}
// True when the user picked "reduce", or follows a device that asks for less motion.
export function prefersReducedMotion(): boolean {
  return motionChoice.get() === "reduce" || deviceReduces();
}
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
}

// Map view: flat, or tilted 3D with height for time or for utility (components/map3d.ts).
export const mapViewChoice = savedChoice("seams.map-view", (v) => v === "flat" || v === "time" || v === "utility");
