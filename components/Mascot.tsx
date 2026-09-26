"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

// Reactions used by the app. The mascot script supports more.
export type MascotReaction =
  | "idle"
  | "thinking"
  | "alert"
  | "found"
  | "wide"
  | "error"
  | "confused"
  | "sleep";

export interface MascotHandle {
  play(name: MascotReaction): Promise<void>;
}

interface ArcElement extends HTMLElement {
  play(name: string): Promise<void>;
  set(name: string): ArcElement;
}

// These hold until something else plays. Everything else is a one-shot that returns to the resting state.
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

// Load the mascot web component once, in the browser only.
function loadScript(): Promise<void> {
  if (customElements.get("arc-mascot")) return Promise.resolve();
  if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  return customElements.whenDefined("arc-mascot").then(() => undefined);
}

export default function Mascot({ ref, size = 96 }: { ref?: Ref<MascotHandle>; size?: number }) {
  const el = useRef<ArcElement>(null);
  const ready = useRef<Promise<void> | null>(null);

  useEffect(() => {
    ready.current = loadScript();
  }, []);

  useImperativeHandle(ref, () => ({
    async play(name) {
      await ready.current;
      const arc = el.current;
      if (!arc?.play) return;
      // One-shots go back to the resting state when done. Make that idle,
      // otherwise they would fall back to an earlier "thinking" or "sleep".
      if (!LOOPING.includes(name)) arc.set("idle");
      await arc.play(name);
    },
  }));

  return (
    <div className="pointer-events-auto text-text" aria-hidden="true">
      <arc-mascot ref={el} size={String(size)} color="currentColor" />
    </div>
  );
}
