"use client";

import { useEffect, useRef, useState } from "react";
import ArcColorPicker from "./ArcColorPicker";
import Mascot, { type MascotHandle } from "./Mascot";

interface Props {
  // "ready" once the data and the map are in; "error" if the data failed.
  phase: "loading" | "ready" | "error";
  overlapCount: number;
  // Where the corner Arc sits, so this Arc can fly there before the screen goes.
  target(): DOMRect | null;
  onGone(): void;
}

const SIZE = 150;
// Long enough for one full eye orbit, so a fast load still reads as a moment, not a flash.
const MIN_SHOW_MS = 1_400;
const STEPS = ["Loading GPC and DESC projects", "Loading ranked overlaps", "Drawing the map"];

// Arc's idle pose as a plain path, shown until the animated Arc is ready (and if it never loads).
// Same shape as the "SVG right" export in Arc Lab.
const IDLE_D =
  "M57.81,35.00 Q58.00,26.00 66.98,25.36 L133.02,20.64 Q142.00,20.00 141.01,28.94 L134.99,83.06 Q134.00,92.00 142.97,92.75 L149.03,93.25 Q158.00,94.00 151.57,100.29 L72.43,177.71 Q66.00,184.00 69.30,175.63 L88.70,126.37 Q92.00,118.00 83.01,118.50 L64.99,119.50 Q56.00,120.00 56.19,111.00ZM76.50,56.00 a7.5,14 0 1,0 15,0 a7.5,14 0 1,0 -15,0 ZM106.50,56.00 a7.5,14 0 1,0 15,0 a7.5,14 0 1,0 -15,0 Z";

type Stage = "loading" | "cheer" | "leaving";

export default function LoadingScreen({ phase, overlapCount, target, onGone }: Props) {
  const shownAt = useRef(0);
  const mascot = useRef<MascotHandle>(null);
  const home = useRef<HTMLDivElement>(null);
  const [arcReady, setArcReady] = useState(false);
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<Stage>("loading");
  const [flight, setFlight] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  // Someone is picking a colour for Arc; wait for them before leaving.
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    shownAt.current = performance.now();
    // Start the bar creeping forward on the next frame so the transition runs.
    const raf = requestAnimationFrame(() => setFilled(true));
    const timer = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 900);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (phase === "loading" || (phase === "ready" && picking)) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - shownAt.current));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    if (phase === "error") {
      later(0, () => setStage("leaving"));
      later(300, onGone);
    } else {
      later(wait, () => {
        setStage("cheer");
        void mascot.current?.play("happy");
      });
      later(wait + 750, () => {
        const to = target();
        const from = home.current?.getBoundingClientRect();
        if (to && from && !reduced && to.width > 0) {
          const dx = to.left + to.width / 2 - (from.left + from.width / 2);
          const dy = to.top + to.height / 2 - (from.top + from.height / 2);
          setFlight(`translate(${dx}px, ${dy}px) scale(${to.width / from.width})`);
        }
        setStage("leaving");
      });
      later(wait + 750 + (reduced ? 250 : 800), onGone);
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, picking, target, onGone]);

  const leaving = stage === "leaving";
  const status = phase === "error" ? "Could not load the data" : stage === "loading" ? STEPS[step] : `Found ${overlapCount} overlaps`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 grid place-items-center ${leaving ? "pointer-events-none" : ""}`}
    >
      {/* Backdrop fades on its own so Arc can keep flying on top of the revealed app. */}
      <div
        aria-hidden
        className={`absolute inset-0 bg-bg transition-opacity duration-500 ease-out ${leaving ? "opacity-0" : "opacity-100"}`}
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--text) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative flex flex-col items-center">
        <div
          aria-hidden
          className={`absolute left-1/2 top-[75px] h-80 w-80 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500 ${leaving ? "opacity-0" : "opacity-100"}`}
          style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--arc) 26%, transparent), transparent)" }}
        />

        <div
          ref={home}
          className="relative z-10"
          style={{
            width: SIZE,
            height: SIZE,
            transform: flight ?? undefined,
            transition: "transform 760ms cubic-bezier(.65,0,.25,1)",
          }}
        >
          {!arcReady && (
            <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full text-arc" aria-hidden>
              <path fill="currentColor" fillRule="evenodd" d={IDLE_D} />
            </svg>
          )}
          <div className="absolute inset-0">
            <Mascot ref={mascot} size={SIZE} initial="waiting-wrap" onReady={() => setArcReady(true)} />
          </div>
        </div>

        <div className={`mt-6 flex flex-col items-center transition-all duration-300 ${leaving ? "translate-y-2 opacity-0" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full-light.svg" alt="Seams" className="h-10 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full-dark.svg" alt="Seams" className="hidden h-10 w-auto dark:block" />
          <p className="mt-1 text-sm text-muted">Where planned grid projects meet</p>

          <div className="mt-7 h-1 w-52 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-arc"
              style={{
                width: stage !== "loading" ? "100%" : filled ? "85%" : "6%",
                transition: stage !== "loading" ? "width 300ms ease-out" : "width 3.2s cubic-bezier(.1,.7,.2,1)",
              }}
            />
          </div>
          <div className="mt-5">
            <ArcColorPicker disabled={leaving} onBusy={setPicking} />
          </div>
          <p key={status} className="mt-3 h-4 animate-[fade-up_300ms_ease-out_both] text-xs text-muted motion-reduce:animate-none">
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}
