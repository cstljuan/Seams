"use client";

import { useId } from "react";
import { ClockIcon } from "./icons";
import type { Filters } from "./overlaps";

interface Props {
  filters: Filters;
  onChange(filters: Filters): void;
}

export default function FilterRow({ filters, onChange }: Props) {
  const id = useId();
  const badRange = filters.start && filters.end && filters.start > filters.end;

  return (
    <fieldset>
      <legend className="sr-only">Filters</legend>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <DateField
          id={`${id}-start`}
          label="In service from"
          value={filters.start}
          max={filters.end || undefined}
          onChange={(start) => onChange({ ...filters, start })}
        />
        <DateField
          id={`${id}-end`}
          label="In service to"
          value={filters.end}
          min={filters.start || undefined}
          onChange={(end) => onChange({ ...filters, end })}
        />
        <button
          type="button"
          role="switch"
          aria-checked={filters.timeOnly}
          onClick={() => onChange({ ...filters, timeOnly: !filters.timeOnly })}
          title="Show only pairs whose build windows overlap"
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2 text-left text-[11px] font-medium leading-tight transition-colors ${
            filters.timeOnly ? "border-accent bg-accent text-surface" : "border-line bg-surface text-text hover:bg-hover"
          }`}
        >
          <ClockIcon className="h-3.5 w-3.5 shrink-0" />
          <span>
            Time overlaps
            <br />
            only
          </span>
        </button>
      </div>
      {badRange && <p className="mt-1.5 text-xs text-tier-1">The start date is after the end date.</p>}
    </fieldset>
  );
}

function DateField(props: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange(v: string): void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={props.id} className="text-xs text-muted">
        {props.label}
      </label>
      <input
        id={props.id}
        type="date"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-1.5 font-mono text-xs text-text"
      />
    </div>
  );
}
