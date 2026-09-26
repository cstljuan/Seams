"use client";

import { useId, useRef, useState } from "react";
import { CloseIcon, PinIcon, SearchIcon } from "./icons";
import { matchPlaces, type Place } from "./places";

const MIN_GAP_MS = 1000; // Nominatim allows 1 request per second.

interface Props {
  onPlace(place: Place): void;
  onBusy(busy: boolean): void;
}

type Status = "idle" | "loading" | "error" | "empty";

export default function LocationSearch({ onPlace, onBusy }: Props) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [online, setOnline] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const lastCall = useRef(0);
  const requestId = useRef(0);

  const local = matchPlaces(query);
  const options = [...local, ...online.filter((o) => !local.some((l) => l.name === o.name))];

  function choose(place: Place) {
    setQuery(place.name.split(",").slice(0, 2).join(","));
    setOpen(false);
    setActive(-1);
    onPlace(place);
  }

  async function searchOnline() {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++requestId.current;
    setStatus("loading");
    setOpen(true);
    onBusy(true);
    try {
      const wait = lastCall.current + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall.current = Date.now();
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(String(res.status));
      const places = (await res.json()) as Place[];
      if (id !== requestId.current) return;
      setOnline(places);
      setStatus(places.length || local.length ? "idle" : "empty");
      setActive(places.length || local.length ? 0 : -1);
    } catch {
      if (id !== requestId.current) return;
      setOnline([]);
      setStatus("error");
    } finally {
      if (id === requestId.current) onBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && options[active]) choose(options[active]);
      else void searchOnline();
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
    }
  }

  const showList = open && query.trim().length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search for a location
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
        <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOnline([]);
            setStatus("idle");
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search a place, e.g. Savannah"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted focus-visible:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOnline([]);
              setStatus("idle");
            }}
            className="rounded p-1 text-muted hover:bg-hover"
            aria-label="Clear search"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showList && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <ul id={listId} role="listbox" aria-label="Places" className="max-h-72 overflow-auto py-1">
            {options.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-hover" : ""}`}
              >
                <PinIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{p.name}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 py-2 text-xs text-muted" aria-live="polite">
            {status === "loading" && "Searching OpenStreetMap…"}
            {status === "error" && "Online search is unavailable. Pick a place from the list."}
            {status === "empty" && "No places found."}
            {status === "idle" && (online.length ? "Results from OpenStreetMap Nominatim." : "Press Enter to search everywhere.")}
          </p>
        </div>
      )}
    </div>
  );
}
