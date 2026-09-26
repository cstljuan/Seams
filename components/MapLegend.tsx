import type { ProjectType } from "@/lib/data";
import { MarkerShape } from "./MapView";

const TYPES: ProjectType[] = ["line", "substation", "rebuild", "reconductor", "other"];

export default function MapLegend({ types }: { types: Set<ProjectType> }) {
  const shown = TYPES.filter((t) => types.has(t));
  return (
    <div className="pointer-events-auto rounded-xl border border-line bg-surface/95 px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-utility-a" /> DESC
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-utility-b" /> GPC
        </span>
        {shown.length > 0 &&
          shown.map((t) => (
            <span key={t} className="flex items-center gap-1 text-muted">
              <span className="text-muted">
                <MarkerShape type={t} size={10} />
              </span>
              {t}
            </span>
          ))}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-muted">
        <span>Tier</span>
        {([1, 2, 3, 4] as const).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className="h-1 w-4 rounded-full" style={{ background: `var(--tier-${t})` }} />
            <span className="font-mono">{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
