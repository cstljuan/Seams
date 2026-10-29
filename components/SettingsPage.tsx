"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_DATASET, datasetChoice, type Dataset } from "@/lib/dataset";
import { ACCESSORIES, arcAccessory } from "./arcAccessories";
import { applyArcColor, arcColor } from "./ArcColorPicker";
import { ChevronIcon } from "./icons";
import Mascot, { type MascotHandle, type MascotReaction } from "./Mascot";
import { applyMotion, mapViewChoice, motionChoice, unitsChoice, type Motion, type Units } from "./settings";
import { THEME_KEY, setColorScheme } from "./useColorScheme";

const PREVIEW_REACTIONS: { id: MascotReaction; label: string }[] = [
  { id: "happy", label: "Happy" },
  { id: "wink", label: "Wink" },
  { id: "alert", label: "Alert" },
  { id: "thinking", label: "Thinking" },
  { id: "sleep", label: "Sleep" },
];

// Quick colours come from the theme, so they always match the app. The wheel can pick anything.
const SWATCH_TOKENS = ["--arc-brand", "--tier-1", "--tier-2", "--tier-4", "--utility-b", "--arc-party"] as const;

const noSubscribe = () => () => {};
const use = <T,>(choice: { subscribe(fn: () => void): () => void; get(): string | null }) =>
  useSyncExternalStore(choice.subscribe, choice.get, () => null) as T | null;

// Theme preference: "system" means nothing saved, so the device decides.
type ThemePref = "system" | "light" | "dark";
function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function setThemePref(pref: ThemePref) {
  if (pref !== "system") {
    setColorScheme(pref);
    return;
  }
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    // Storage blocked: the device setting still applies for this visit.
  }
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Any CSS colour to #rrggbb, so it can be saved and fed to the colour input.
function toHex(value: string): string | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !value) return null;
  ctx.fillStyle = value;
  const out = ctx.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(out) ? out.toLowerCase() : null;
}

export default function SettingsPage() {
  const arc = useRef<MascotHandle>(null);
  const color = use<string>(arcColor);
  const accessory = use<string>(arcAccessory);
  const units = use<Units>(unitsChoice) ?? "km";
  const motion: Motion = use<string>(motionChoice) === "reduce" ? "reduce" : "system";
  const dataset = use<Dataset>(datasetChoice) ?? DEFAULT_DATASET;
  const mapView = use<string>(mapViewChoice) ?? "flat";
  const [theme, setTheme] = useState<ThemePref>("system");
  const [swatches, setSwatches] = useState<string[]>([]);
  const brand = useSyncExternalStore(
    noSubscribe,
    () => toHex(getComputedStyle(document.documentElement).getPropertyValue("--arc-brand").trim()),
    () => null,
  );

  // Browser-only reads after mount, so the server render and the first client render match.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readThemePref());
    const style = getComputedStyle(document.documentElement);
    setSwatches([...new Set(SWATCH_TOKENS.map((t) => toHex(style.getPropertyValue(t).trim())).filter((v): v is string => !!v))]);
  }, []);

  useEffect(() => applyArcColor(color), [color]);
  useEffect(() => applyMotion(motion), [motion]);

  const current = color ?? brand ?? "#f5bc42";
  const pickColor = (hex: string | null) => {
    arcColor.set(hex && hex !== brand ? hex : null);
    void arc.current?.play("happy");
  };
  const pickAccessory = (id: string | null) => {
    arcAccessory.set(id);
    void arc.current?.play(id ? "wink" : "idle");
  };

  return (
    <main className="h-full overflow-y-auto bg-bg text-text">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pb-16 pt-4 sm:px-6 sm:pt-6">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="flex min-h-11 items-center gap-2 rounded-lg pr-3 text-sm font-medium text-muted hover:text-text">
            <ChevronIcon className="h-4 w-4 rotate-180" />
            Back to the map
          </Link>
          <Link href="/" aria-label="Seams home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-full-light.svg" alt="Seams" className="h-7 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-full-dark.svg" alt="Seams" className="hidden h-7 w-auto dark:block" />
          </Link>
        </header>

        <div>
          <h1 className="text-3xl font-semibold leading-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted">Saved in this browser only. Nothing is sent anywhere.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start">
          {/* Live preview. Sticks beside the controls on wide screens. */}
          <section id="arc" aria-label="Arc preview" className="scroll-mt-6 rounded-2xl border border-line bg-surface p-5 md:sticky md:top-6">
            <div className="grid place-items-center py-4">
              <Mascot ref={arc} size={168} />
            </div>
            <p className="text-center text-sm font-medium">Arc</p>
            <p className="text-center text-xs text-muted">Changes show up everywhere Arc appears.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Preview a reaction">
              {PREVIEW_REACTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void arc.current?.play(r.id)}
                  className="min-h-11 rounded-full border border-line px-3 text-xs hover:bg-hover"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-6">
            <Card title="Arc's colour" hint="Pick one of the grid colours, or any colour at all.">
              <div className="flex flex-wrap items-center gap-2">
                {swatches.map((hex) => {
                  const on = current.toLowerCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => pickColor(hex)}
                      aria-label={hex === brand ? "Arc gold" : `Colour ${hex}`}
                      aria-pressed={on}
                      className={`grid h-11 w-11 place-items-center rounded-full border-2 ${on ? "border-text" : "border-transparent"}`}
                    >
                      <span className="h-8 w-8 rounded-full" style={{ background: hex }} />
                    </button>
                  );
                })}
                {/* The system colour wheel, behind a rainbow ring. The input sits on top, see-through. */}
                <label
                  className="relative grid h-11 w-11 cursor-pointer place-items-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                  style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
                  title="Any colour"
                >
                  <span className="h-7 w-7 rounded-full border-2 border-surface bg-arc" />
                  <input
                    type="color"
                    aria-label="Any colour for Arc"
                    value={current}
                    onChange={(e) => arcColor.set(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
                {color && (
                  <button type="button" onClick={() => pickColor(null)} className="min-h-11 rounded-full border border-line px-4 text-xs hover:bg-hover">
                    Back to gold
                  </button>
                )}
              </div>
            </Card>

            <Card title="Arc's accessory" hint="Worn on the map and the loading screen.">
              <Segmented
                label="Arc's accessory"
                value={accessory ?? ""}
                onChange={(v) => pickAccessory(v || null)}
                options={[{ id: "", label: "None" }, ...ACCESSORIES.map((a) => ({ id: a.id as string, label: a.label }))]}
              />
            </Card>

            <Card title="Theme">
              <Segmented
                label="Theme"
                value={theme}
                onChange={(v) => {
                  setTheme(v as ThemePref);
                  setThemePref(v as ThemePref);
                }}
                options={[
                  { id: "system", label: "Device" },
                  { id: "light", label: "Light" },
                  { id: "dark", label: "Dark" },
                ]}
              />
            </Card>

            <Card title="Distances">
              <Segmented
                label="Distance units"
                value={units}
                onChange={(v) => unitsChoice.set(v === "mi" ? "mi" : null)}
                options={[
                  { id: "km", label: "Kilometres" },
                  { id: "mi", label: "Miles" },
                ]}
              />
            </Card>

            <Card title="Motion" hint="Reduce turns off the loading fly-in, Arc's typing and other animation.">
              <Segmented
                label="Motion"
                value={motion}
                onChange={(v) => motionChoice.set(v === "reduce" ? "reduce" : null)}
                options={[
                  { id: "system", label: "Follow device" },
                  { id: "reduce", label: "Reduce" },
                ]}
              />
            </Card>

            <Card title="Map view" hint="Same switch as the top right of the map. 3D views tilt the map and use height for a second dimension.">
              <Segmented
                label="Map view"
                value={mapView}
                onChange={(v) => mapViewChoice.set(v === "flat" ? null : v)}
                options={[
                  { id: "flat", label: "2D" },
                  { id: "time", label: "3D time" },
                  { id: "utility", label: "3D utility" },
                ]}
              />
            </Card>

            <Card title="Data the map opens with">
              <Segmented
                label="Default dataset"
                value={dataset}
                onChange={(v) => datasetChoice.set(v === "sample" ? "sample" : "illustrative")}
                options={[
                  { id: "illustrative", label: "Illustrative" },
                  { id: "sample", label: "Sperry sample" },
                ]}
              />
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Illustrative is about 3,400 made-up projects from 33 utilities, placed on real US towns. Only DESC and
                Georgia Power, with their 10 real projects from the Sperry Tech GridLock sample, are real. The Sperry
                sample shows real data only.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange(v: string): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg p-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(o.id)}
            className={`min-h-11 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors ${
              on ? "bg-accent text-surface" : "text-muted hover:bg-hover hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
