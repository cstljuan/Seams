"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import ArcColorPicker from "./ArcColorPicker";
import Mascot, { type MascotGesture, type MascotHandle, type MascotReaction } from "./Mascot";

export interface ArcCornerHandle extends MascotHandle {
  // Show a speech bubble, optionally with a reaction.
  say(text: string, reaction?: MascotReaction): void;
  // Where Arc sits on screen, so the loading screen can fly him here.
  rect(): DOMRect | null;
}

interface Props {
  ref?: Ref<ArcCornerHandle>;
  // Lines Arc cycles through when clicked.
  tips: string[];
  hidden?: boolean;
}

const SIZE = 96;
// Reactions for a click, in turn, so two clicks in a row always look different.
const CLICK_REACTIONS: MascotReaction[] = ["happy", "wink", "surprise", "success", "found"];
const GESTURE_LINES: Record<MascotGesture, string[]> = {
  drag: ["Whee!", "Boing. I always snap back.", "Careful, I'm high voltage."],
  tip: ["Hey, that's my tip!", "Careful, that's the pointy end."],
  hold: ["Squish.", "Okay, okay, I'm squished!"],
};
// This many clicks inside the window gets a different answer.
const SPAM_CLICKS = 5;
const SPAM_WINDOW_MS = 2_500;

const CHARS_PER_MS = 0.07;

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export default function ArcCorner({ ref, tips, hidden = false }: Props) {
  const mascot = useRef<MascotHandle>(null);
  const box = useRef<HTMLButtonElement>(null);
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null);
  const bubbleId = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lastState = useRef("idle");
  const wokeAt = useRef(0);
  const gesture = useRef<MascotGesture | null>(null);
  const clicks = useRef<number[]>([]);
  const turn = useRef(0);

  const say = useCallback((text: string, reaction?: MascotReaction) => {
    if (reaction) void mascot.current?.play(reaction);
    const id = ++bubbleId.current;
    setBubble({ id, text });
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBubble((b) => (b?.id === id ? null : b)), Math.min(9_000, 2_600 + text.length * 45));
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useImperativeHandle(ref, () => ({
    play: (name) => mascot.current?.play(name) ?? Promise.resolve(),
    say,
    rect: () => box.current?.querySelector("arc-mascot")?.getBoundingClientRect() ?? null,
  }));

  const onState = useCallback((s: string) => {
    if (lastState.current === "sleep" && s !== "sleep") wokeAt.current = Date.now();
    lastState.current = s;
  }, []);

  // Arc plays his own animation for a gesture. We add a line once the pointer lets go.
  const onGesture = useCallback(
    (g: MascotGesture) => {
      gesture.current = g;
      const release = () => say(pick(GESTURE_LINES[g]));
      window.addEventListener("pointerup", release, { once: true });
    },
    [say],
  );

  const onClick = (e: React.MouseEvent) => {
    // A drag or a hold also ends in a click. Those already got their own reaction.
    if (e.detail > 0 && gesture.current) return;

    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < SPAM_WINDOW_MS), now];
    if (clicks.current.length >= SPAM_CLICKS) {
      clicks.current = [];
      say("Okay, okay! I'm a lightning bolt, not a button.", "error");
      return;
    }
    // The app wakes Arc on any input, so check whether he was asleep a moment ago.
    if (lastState.current === "sleep" || now - wokeAt.current < 800) {
      say("Huh? Oh! I'm up. I'm up.", "wake");
      return;
    }
    const i = turn.current++;
    say(tips[i % tips.length] ?? "Hi, I'm Arc.", CLICK_REACTIONS[i % CLICK_REACTIONS.length]);
  };

  return (
    <div className={`absolute bottom-6 left-3 z-10 ${hidden ? "invisible" : ""}`}>
      {bubble && (
        <div
          key={bubble.id}
          onClick={() => setBubble(null)}
          className="absolute bottom-[78px] left-[84px] w-max max-w-[270px] origin-bottom-left cursor-default animate-[arc-bubble-in_260ms_cubic-bezier(.2,.9,.3,1.25)_both] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-sm leading-snug shadow-lg motion-reduce:animate-none"
        >
          <Typed text={bubble.text} />
          <span aria-hidden className="absolute -bottom-[6px] left-3 h-3 w-3 rotate-45 border-b border-r border-line bg-surface" />
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {bubble?.text}
      </p>
      <button
        ref={box}
        type="button"
        onPointerDownCapture={() => (gesture.current = null)}
        onClick={onClick}
        aria-label="Arc, the Seams guide. Press for a tip."
        title="Click me. Or drag me."
        className="block rounded-full drop-shadow-[0_10px_14px_rgba(15,27,45,0.22)] transition-transform duration-200 hover:scale-[1.06] active:scale-95 motion-reduce:transition-none"
      >
        <Mascot ref={mascot} size={SIZE} onState={onState} onGesture={onGesture} />
      </button>
      {/* Pick any colour for Arc; the loading screen has the same picker. */}
      <div className="absolute bottom-1 left-[92px]">
        <ArcColorPicker variant="compact" disabled={hidden} />
      </div>
    </div>
  );
}

// Types the line out a few letters at a time. Screen readers get the full text from the live region instead.
function Typed({ text }: { text: string }) {
  // The bubble is keyed per line, so this starts fresh for every new line.
  const [shown, setShown] = useState(() => (matchMedia("(prefers-reduced-motion: reduce)").matches ? text.length : 0));
  useEffect(() => {
    // Driven by elapsed time, so a busy frame (the map flying) skips letters instead of slowing down.
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const n = Math.min(text.length, Math.ceil((now - start) * CHARS_PER_MS));
      setShown((prev) => Math.max(prev, n));
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return (
    <span aria-hidden className="relative block">
      {/* The full text holds the bubble at its final size while the rest types in. */}
      <span className="invisible">{text}</span>
      <span className="absolute inset-0">{text.slice(0, shown)}</span>
    </span>
  );
}
