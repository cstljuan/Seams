"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

// Reactions used by the app. The mascot script supports more.
export type MascotReaction =
  | "idle"
  | "thinking"
  | "waiting-wrap"
  | "alert"
  | "found"
  | "wide"
  | "error"
  | "confused"
  | "sleep"
  | "wake"
  | "happy"
  | "wink"
  | "success"
  | "surprise";

// What Arc does when someone plays with him directly (see arc-mascot.js).
export type MascotGesture = "drag" | "tip" | "hold";

export interface MascotHandle {
  play(name: MascotReaction): Promise<void>;
}

// The only method we rely on, so new mascot art can be swapped in.
// play() should return a Promise that resolves when a one-shot reaction ends.
interface ArcElement extends HTMLElement {
  play(name: string): Promise<void> | void;
}

// These hold until something else plays. The rest are one-shots.
const LOOPING: MascotReaction[] = ["idle", "thinking", "waiting-wrap", "sleep"];

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "arc-mascot": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        size?: string;
        color?: string;
        state?: string;
      };
    }
  }
}

const SCRIPT_SRC = "/brand/arc-mascot.js";

const LOAD_TIMEOUT_MS = 8_000;

// Load the mascot web component once, in the browser only.
// Rejects if the script fails or never defines the element, so reactions don't wait forever.
function loadScript(): Promise<void> {
  if (customElements.get("arc-mascot")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    const timer = setTimeout(() => reject(new Error("Arc did not load in time")), LOAD_TIMEOUT_MS);
    script.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Arc script failed to load"));
    });
    customElements.whenDefined("arc-mascot").then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

interface Props {
  ref?: Ref<MascotHandle>;
  size?: number;
  // Held state to start in, e.g. "waiting-wrap" on the loading screen.
  initial?: MascotReaction;
  onReady?(): void;
  onState?(state: string): void;
  onGesture?(gesture: MascotGesture): void;
}

export default function Mascot({ ref, size = 96, initial, onReady, onState, onGesture }: Props) {
  const el = useRef<ArcElement>(null);
  const ready = useRef<Promise<void> | null>(null);
  const lastPlay = useRef(0);

  const [failed, setFailed] = useState(false);

  // Keep the latest callbacks without re-running the effects below.
  const cb = useRef({ onReady, onState, onGesture });
  useEffect(() => {
    cb.current = { onReady, onState, onGesture };
  });

  useEffect(() => {
    const p = loadScript();
    ready.current = p;
    p.then(
      () => cb.current.onReady?.(),
      () => setFailed(true),
    );
  }, []);

  // Arc reports its own state changes and gestures (drag, drag the tip, press and hold).
  useEffect(() => {
    const arc = el.current;
    if (!arc) return;
    const state = (e: Event) => cb.current.onState?.((e as CustomEvent<string>).detail);
    const gesture = (e: Event) => cb.current.onGesture?.((e as CustomEvent<MascotGesture>).detail);
    arc.addEventListener("arc-state", state);
    arc.addEventListener("arc-gesture", gesture);
    return () => {
      arc.removeEventListener("arc-state", state);
      arc.removeEventListener("arc-gesture", gesture);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    async play(name) {
      const id = ++lastPlay.current;
      try {
        await ready.current;
      } catch {
        return; // Arc is decorative; the app keeps working without it.
      }
      const arc = el.current;
      if (!arc?.play) return;
      const done = arc.play(name);
      // After a one-shot, go back to idle, not to an earlier "thinking" or "sleep".
      // Only when play() tells us it finished, and no other reaction started since.
      if (LOOPING.includes(name) || !(done instanceof Promise)) return;
      await done;
      if (id === lastPlay.current) await arc.play("idle");
    },
  }));

  if (failed) return null;

  return (
    // SVG fill attributes can't read CSS variables, so --arc reaches Arc through currentColor.
    <div className="pointer-events-auto" style={{ color: "var(--arc)" }} aria-hidden="true">
      <arc-mascot ref={el} size={String(size)} color="currentColor" state={initial} />
    </div>
  );
}
