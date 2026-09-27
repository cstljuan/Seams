"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

// Reactions used by the app. The mascot script supports more.
export type MascotReaction =
  | "idle"
  | "thinking"
  | "alert"
  | "found"
  | "wide"
  | "error"
  | "confused"
  | "sleep"
  | "happy";

export interface MascotHandle {
  play(name: MascotReaction): Promise<void>;
}

// The only method we rely on, so new mascot art can be swapped in.
// play() should return a Promise that resolves when a one-shot reaction ends.
interface ArcElement extends HTMLElement {
  play(name: string): Promise<void> | void;
}

// These hold until something else plays. The rest are one-shots.
const LOOPING: MascotReaction[] = ["idle", "thinking", "sleep"];

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

export default function Mascot({ ref, size = 96 }: { ref?: Ref<MascotHandle>; size?: number }) {
  const el = useRef<ArcElement>(null);
  const ready = useRef<Promise<void> | null>(null);
  const lastPlay = useRef(0);

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const p = loadScript();
    ready.current = p;
    p.catch(() => setFailed(true));
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
      <arc-mascot ref={el} size={String(size)} color="currentColor" />
    </div>
  );
}
