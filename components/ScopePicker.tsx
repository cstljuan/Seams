"use client";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export const stateName = (code: string) => STATE_NAMES[code] ?? code;

interface Props {
  // "" means the whole country.
  scope: string;
  // State code to number of pairs touching it.
  states: [string, number][];
  count: number;
  onChange(scope: string): void;
  // Phones: no "Scope" label or count chip, to fit beside the view switch.
  compact?: boolean;
}

// Narrows the whole app to one state, so a dense national dataset stays readable. Sits top centre on the map.
export default function ScopePicker({ scope, states, count, onChange, compact = false }: Props) {
  return (
    <label className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface/95 py-1 pl-3.5 pr-1 shadow-md">
      {!compact && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Scope</span>}
      <select
        value={scope}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Scope"
        className={`min-h-8 cursor-pointer rounded-full bg-transparent pr-1 font-semibold text-text outline-none ${compact ? "max-w-[9.5rem] text-xs" : "text-sm"}`}
      >
        <option value="">{compact ? "All US" : "United States"}</option>
        {states.map(([code, n]) => (
          <option key={code} value={code}>
            {stateName(code)} ({n.toLocaleString("en-US")})
          </option>
        ))}
      </select>
      {!compact && (
        <span className="rounded-full bg-hover px-2.5 py-1 font-mono text-xs text-muted" aria-live="polite">
          {count.toLocaleString("en-US")}
        </span>
      )}
    </label>
  );
}
