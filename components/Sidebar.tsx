"use client";

import { useMemo, useState } from "react";
import type { Overlap, SeamsData, UtilityInfo } from "@/lib/data";
import type { Dataset } from "@/lib/dataset";
import AppMenu from "./AppMenu";
import DatasetToggle from "./DatasetToggle";
import FilterRow from "./FilterRow";
import LocationSearch from "./LocationSearch";
import OverlapList from "./OverlapList";
import ThemeToggle from "./ThemeToggle";
import TimelineView from "./TimelineView";
import { SearchIcon } from "./icons";
import { GROUPS, SORTS, groupOverlaps, honestSavings, neighbours, sortOverlaps, type GroupKey, type SortKey } from "./explore";
import { EMPTY_FILTERS, formatUsd, hasFilters, type Filters, type ProjectIndex } from "./overlaps";
import type { Place } from "./places";

// The list shows this many rows at a time, so a big dataset stays quick on phones.
const PAGE_SIZE = 100;

export type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SeamsData };

interface Props {
  menuItems: { label: string; onSelect(): void }[];
  dataset: Dataset;
  onDatasetChange(next: Dataset): void;
  datasetDisabled: boolean;
  onPlace(place: Place): void;
  onSearchBusy(busy: boolean): void;
  filters: Filters;
  onFiltersChange(next: Filters): void;
  load: LoadState;
  // Overlaps after filters, in list order.
  visible: Overlap[];
  index: ProjectIndex;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onRetry(): void;
  // Set when the list only shows pairs in the map view; the button zooms back out.
  inView?: { onShowAll(): void };
  // Utility spotlight: "" for none.
  spotlight: string;
  onSpotlight(utility: string): void;
  utilities: UtilityInfo[];
  // Opens the command palette.
  onOpenPalette(): void;
}

// Everything in the overlaps panel: header, dataset, search, filters and the ranked list.
// The desktop sidebar and (later) the phone bottom sheet both render this.
export default function SidebarPanel({
  menuItems,
  dataset,
  onDatasetChange,
  datasetDisabled,
  onPlace,
  onSearchBusy,
  filters,
  onFiltersChange: changeFilters,
  load,
  visible,
  index,
  selectedId,
  onSelect: select,
  onRetry: retry,
  inView,
  spotlight,
  onSpotlight,
  utilities,
  onOpenPalette,
}: Props) {
  const data = load.status === "ready" ? load.data : null;
  const [sort, setSort] = useState<SortKey>("severity");
  const [group, setGroup] = useState<GroupKey>("none");
  const [mode, setMode] = useState<"list" | "timeline">("list");
  const sorted = useMemo(() => sortOverlaps(visible, sort, index), [visible, sort, index]);
  const savings = useMemo(() => honestSavings(visible), [visible]);
  const near = useMemo(() => (spotlight ? neighbours(visible, spotlight, index).slice(0, 5) : []), [visible, spotlight, index]);
  const selected = visible.find((o) => o.id === selectedId) ?? null;
  const [shown, setShown] = useState(PAGE_SIZE);
  // Back to the first page whenever the list itself changes.
  const [shownFor, setShownFor] = useState(sorted);
  if (shownFor !== sorted) {
    setShownFor(sorted);
    setShown(PAGE_SIZE);
  }
  // A pair opened from the map may sit further down; show enough rows to include it.
  const selectedIndex = selected ? sorted.indexOf(selected) : -1;
  const rows = useMemo(() => sorted.slice(0, Math.max(shown, selectedIndex + 1)), [sorted, shown, selectedIndex]);
  const groups = useMemo(() => (group === "none" ? null : groupOverlaps(sorted, group, index)), [group, sorted, index]);

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:min-w-[360px]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-full-light.svg" alt="Seams" className="h-8 w-auto dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-full-dark.svg" alt="Seams" className="hidden h-8 w-auto dark:block" />
            </h1>
            <span className="text-xs leading-tight text-muted">Where planned grid projects meet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenPalette}
              aria-label="Jump to (Cmd or Ctrl + K)"
              title="Jump to (Cmd or Ctrl + K)"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface hover:bg-hover"
            >
              <SearchIcon className="h-3.5 w-3.5" />
            </button>
            <ThemeToggle />
            <AppMenu items={menuItems} />
          </div>
        </header>
        <DatasetToggle dataset={dataset} onChange={onDatasetChange} disabled={datasetDisabled} />
        <LocationSearch onPlace={onPlace} onBusy={onSearchBusy} />
        <FilterRow filters={filters} onChange={changeFilters} />
        {utilities.length > 2 && (
          <label className="flex items-center gap-2 text-xs">
            <span className="shrink-0 text-muted">Spotlight</span>
            <select
              value={spotlight}
              onChange={(e) => onSpotlight(e.target.value)}
              aria-label="Spotlight a utility"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-xs text-text"
            >
              <option value="">All utilities</option>
              {utilities.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} · {u.name}
                  {u.fictional ? "" : " (real)"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:min-w-[360px]">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-sm font-semibold">
            {inView ? "In view" : "Ranked overlaps"}
            {data && (
              <span className="ml-1.5 font-mono font-normal text-muted" aria-live="polite">
                {visible.length === data.overlaps.length
                  ? visible.length.toLocaleString("en-US")
                  : `${visible.length.toLocaleString("en-US")} of ${data.overlaps.length.toLocaleString("en-US")}`}
              </span>
            )}
          </h2>
          {inView && !hasFilters(filters) && (
            <button type="button" onClick={inView.onShowAll} className="text-xs text-accent hover:underline">
              Show all
            </button>
          )}
          {hasFilters(filters) && (
            <button type="button" onClick={() => changeFilters(EMPTY_FILTERS)} className="text-xs text-accent hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {data && visible.length > 0 && (
          <div className="flex flex-col gap-2 px-4 pb-2">
            <div className="flex items-center gap-1.5 text-xs">
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-text">
                {SORTS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} aria-label="Group by" disabled={mode === "timeline"} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-text disabled:opacity-50">
                {GROUPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id === "none" ? o.label : `By ${o.label.toLowerCase()}`}
                  </option>
                ))}
              </select>
              <div role="radiogroup" aria-label="List or timeline" className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
                {(["list", "timeline"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2 py-1 capitalize ${mode === m ? "bg-accent text-surface" : "text-muted hover:text-text"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {savings.pairs > 0 && (
              <p
                className="text-[11px] leading-snug text-muted"
                title="Pairs share projects, so adding every pair would count savings twice. This takes pairs by median savings and counts each project once, then adds their P10 and P90. A model estimate, not a quote."
              >
                Coordinating these could save{" "}
                <span className="font-mono text-text">
                  {formatUsd(savings.p10)} to {formatUsd(savings.p90)}
                </span>{" "}
                across {savings.pairs.toLocaleString("en-US")} {savings.pairs === 1 ? "pair" : "pairs"}, each project counted once.
              </p>
            )}
            {spotlight && near.length > 0 && (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                <p className="mb-1 font-semibold">{spotlight} collides most with</p>
                <ol className="flex flex-col gap-0.5">
                  {near.map((n) => (
                    <li key={n.code} className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => onSpotlight(n.code)} className="font-medium text-accent hover:underline">
                        {n.code}
                      </button>
                      <span className="font-mono text-muted">
                        {n.pairs} {n.pairs === 1 ? "pair" : "pairs"}
                        {n.close ? `, ${n.close} tier 1 or 2` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {load.status === "loading" && <LoadingList />}
          {load.status === "error" && <ErrorState message={load.message} onRetry={retry} />}
          {data && visible.length === 0 && (
            <EmptyState filters={filters} onClear={() => changeFilters(EMPTY_FILTERS)} />
          )}
          {data && visible.length > 0 && mode === "timeline" && (
            <TimelineView overlaps={rows} index={index} selectedId={selected?.id ?? null} onSelect={select} />
          )}
          {data && visible.length > 0 && mode === "list" && groups && (
            <div className="flex flex-col gap-2">
              {groups.map((g, i) => (
                <GroupSection key={`${group}-${g.key}`} label={g.label} items={g.items} open={i === 0} index={index} selectedId={selected?.id ?? null} onSelect={select} />
              ))}
            </div>
          )}
          {data && visible.length > 0 && (mode === "timeline" || !groups) && (
            <>
              {mode === "list" && <OverlapList overlaps={rows} index={index} selectedId={selected?.id ?? null} onSelect={select} />}
              {rows.length < visible.length && (
                <button
                  type="button"
                  onClick={() => setShown(rows.length + PAGE_SIZE)}
                  className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium hover:bg-hover"
                >
                  Show {Math.min(PAGE_SIZE, visible.length - rows.length)} more ({(visible.length - rows.length).toLocaleString("en-US")} left)
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function LoadingList() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading overlaps…</span>
      <ul className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="animate-pulse rounded-xl border border-line bg-surface p-3">
            <div className="h-3 w-1/3 rounded bg-hover" />
            <div className="mt-2 h-2.5 w-4/5 rounded bg-hover" />
            <div className="mt-1.5 h-2.5 w-3/5 rounded bg-hover" />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-xs text-muted">Loading overlaps…</p>
    </div>
  );
}

// Say which filter hid everything, so the fix is obvious.
function emptyReason(f: Filters): string {
  const parts: string[] = [];
  if (f.start || f.end) parts.push(`no pair has both in-service dates ${f.start ? `after ${f.start}` : ""}${f.start && f.end ? " and " : ""}${f.end ? `before ${f.end}` : ""}`);
  if (f.timeOnly) parts.push("“Time overlaps only” keeps just pairs with in-service dates within a year");
  return parts.length ? `${parts.join("; ")}.` : "The data has no overlaps yet.";
}

function EmptyState({ filters, onClear }: { filters: Filters; onClear(): void }) {
  const filtered = hasFilters(filters);
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center" role="status">
      <p className="text-sm font-medium">No overlaps match</p>
      <p className="mt-1 text-xs text-muted">{filtered ? emptyReason(filters) : "The data has no overlaps yet."}</p>
      {filtered && (
        <button type="button" onClick={onClear} className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:bg-hover">
          Clear filters
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="rounded-xl border border-tier-1 bg-surface px-4 py-6 text-center" role="alert">
      <p className="text-sm font-medium">Could not load the data</p>
      <p className="mt-1 break-words font-mono text-xs text-muted">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs hover:bg-hover">
        Try again
      </button>
    </div>
  );
}

// One collapsible group of the list, paged on its own so a big group does not render thousands of rows.
function GroupSection({
  label,
  items,
  open: startOpen,
  index,
  selectedId,
  onSelect,
}: {
  label: string;
  items: Overlap[];
  open: boolean;
  index: ProjectIndex;
  selectedId: string | null;
  onSelect(id: string | null): void;
}) {
  const hasSelected = !!selectedId && items.some((o) => o.id === selectedId);
  const [open, setOpen] = useState(startOpen);
  const [shown, setShown] = useState(30);
  const isOpen = open || hasSelected;
  const sel = hasSelected ? items.findIndex((o) => o.id === selectedId) : -1;
  const rows = items.slice(0, Math.max(shown, sel + 1));
  return (
    <section className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold hover:bg-hover"
      >
        <span className="truncate">{label}</span>
        <span className="font-mono text-xs font-normal text-muted">{items.length.toLocaleString("en-US")}</span>
      </button>
      {isOpen && (
        <div className="px-2 pb-2">
          <OverlapList overlaps={rows} index={index} selectedId={selectedId} onSelect={onSelect} />
          {rows.length < items.length && (
            <button
              type="button"
              onClick={() => setShown(rows.length + 30)}
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-hover"
            >
              Show {Math.min(30, items.length - rows.length)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
