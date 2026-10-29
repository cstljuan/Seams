"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeamsData } from "@/lib/data";
import { SearchIcon } from "./icons";
import { cleanText } from "./overlaps";
import { stateName } from "./ScopePicker";

export interface PaletteItem {
  id: string;
  kind: "Pair" | "Project" | "Utility" | "State" | "Action";
  label: string;
  hint?: string;
  // Lowercase text the query is matched against.
  text: string;
  run(): void;
}

interface Props {
  open: boolean;
  onClose(): void;
  data: SeamsData | null;
  actions(): PaletteItem[];
  onPair(id: string): void;
  onProject(id: string): void;
  onUtility(code: string): void;
  onState(code: string): void;
  // Typing a secret word does something fun (see SeamsApp).
  onSecret?(word: string): void;
}

const LIMIT = 40;

// Score a match: every word of the query must appear; earlier and word-start matches rank higher.
function score(text: string, words: string[]): number {
  let total = 0;
  for (const w of words) {
    const at = text.indexOf(w);
    if (at < 0) return -1;
    total += at === 0 ? 0 : text[at - 1] === " " ? 1 : 3 + at / 100;
  }
  return total;
}

// Jump to any pair, project, utility, state or action by typing. Cmd+K or Ctrl+K opens it.
export default function CommandPalette({ open, onClose, data, actions, onPair, onProject, onUtility, onState, onSecret }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    if (!data) return actions();
    const byId = new Map(data.projects.map((p) => [p.properties.id, p.properties]));
    const pairs: PaletteItem[] = data.overlaps.map((o) => {
      const a = byId.get(o.a);
      const b = byId.get(o.b);
      return {
        id: `pair-${o.id}`,
        kind: "Pair",
        label: `#${o.rank} ${a?.utility ?? "?"} and ${b?.utility ?? "?"}`,
        hint: `Tier ${o.tier}, ${o.distance_km.toFixed(1)} km`,
        text: `#${o.rank} ${o.id} ${a?.utility ?? ""} ${b?.utility ?? ""}`.toLowerCase(),
        run: () => onPair(o.id),
      };
    });
    const projects: PaletteItem[] = data.projects.map((p) => ({
      id: `project-${p.properties.id}`,
      kind: "Project",
      label: cleanText(p.properties.name),
      hint: `${p.properties.utility} · ${p.properties.state}`,
      text: `${cleanText(p.properties.name)} ${p.properties.id} ${p.properties.utility} ${p.properties.state}`.toLowerCase(),
      run: () => onProject(p.properties.id),
    }));
    const utilities: PaletteItem[] = data.utilities.map((u) => ({
      id: `utility-${u.code}`,
      kind: "Utility",
      label: `${u.code} · ${u.name}`,
      hint: u.fictional ? "Spotlight (invented)" : "Spotlight",
      text: `${u.code} ${u.name}`.toLowerCase(),
      run: () => onUtility(u.code),
    }));
    const states: PaletteItem[] = [...new Set(data.projects.map((p) => p.properties.state))].sort().map((st) => ({
      id: `state-${st}`,
      kind: "State",
      label: stateName(st),
      hint: "Scope",
      text: `${stateName(st)} ${st}`.toLowerCase(),
      run: () => onState(st),
    }));
    return [...actions(), ...utilities, ...states, ...pairs, ...projects];
  }, [open, data, actions, onPair, onProject, onUtility, onState]);

  const results = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return items.filter((i) => i.kind === "Action" || i.kind === "Utility").slice(0, LIMIT);
    const scored: { item: PaletteItem; s: number }[] = [];
    for (const item of items) {
      const s = score(item.text, words);
      if (s >= 0) scored.push({ item, s });
    }
    // Stable kinds order on ties: actions, utilities, states, pairs, projects.
    return scored.sort((x, y) => x.s - y.s).slice(0, LIMIT).map((x) => x.item);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setActive(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  // Escape closes from anywhere while open, even before the field has focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              const w = e.target.value.trim().toLowerCase();
              if (w === "arc") onSecret?.(w);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            placeholder="Jump to a pair (#12), project, utility, state or action"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">Esc</kbd>
        </div>
        <ul ref={list} id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</li>}
          {results.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => run(item)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-hover" : ""}`}
            >
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">{item.kind}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs text-muted">{item.hint}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Up and Down to move, Enter to go. Cmd or Ctrl + K opens this anywhere.</p>
      </div>
    </div>
  );
}
