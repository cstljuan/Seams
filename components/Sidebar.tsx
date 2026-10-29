"use client";

import { useMemo, useState } from "react";
import type { Overlap, SeamsData } from "@/lib/data";
import type { Dataset } from "@/lib/dataset";
import AppMenu from "./AppMenu";
import DatasetToggle from "./DatasetToggle";
import FilterRow from "./FilterRow";
import LocationSearch from "./LocationSearch";
import OverlapList from "./OverlapList";
import ThemeToggle from "./ThemeToggle";
import { EMPTY_FILTERS, hasFilters, type Filters, type ProjectIndex } from "./overlaps";
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
}: Props) {
  const data = load.status === "ready" ? load.data : null;
  const selected = visible.find((o) => o.id === selectedId) ?? null;
  const [shown, setShown] = useState(PAGE_SIZE);
  // Back to the first page whenever the list itself changes.
  const [shownFor, setShownFor] = useState(visible);
  if (shownFor !== visible) {
    setShownFor(visible);
    setShown(PAGE_SIZE);
  }
  // A pair opened from the map may sit further down; show enough rows to include it.
  const selectedIndex = selected ? visible.indexOf(selected) : -1;
  const rows = useMemo(() => visible.slice(0, Math.max(shown, selectedIndex + 1)), [visible, shown, selectedIndex]);

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
            <ThemeToggle />
            <AppMenu items={menuItems} />
          </div>
        </header>
        <DatasetToggle dataset={dataset} onChange={onDatasetChange} disabled={datasetDisabled} />
        <LocationSearch onPlace={onPlace} onBusy={onSearchBusy} />
        <FilterRow filters={filters} onChange={changeFilters} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:min-w-[360px]">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-sm font-semibold">
            Ranked overlaps
            {data && (
              <span className="ml-1.5 font-mono font-normal text-muted" aria-live="polite">
                {visible.length === data.overlaps.length ? visible.length : `${visible.length} of ${data.overlaps.length}`}
              </span>
            )}
          </h2>
          {hasFilters(filters) && (
            <button type="button" onClick={() => changeFilters(EMPTY_FILTERS)} className="text-xs text-accent hover:underline">
              Clear filters
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {load.status === "loading" && <LoadingList />}
          {load.status === "error" && <ErrorState message={load.message} onRetry={retry} />}
          {data && visible.length === 0 && (
            <EmptyState filters={filters} onClear={() => changeFilters(EMPTY_FILTERS)} />
          )}
          {data && visible.length > 0 && (
            <>
              <OverlapList overlaps={rows} index={index} selectedId={selected?.id ?? null} onSelect={select} />
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
