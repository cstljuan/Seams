"use client";

import { useSyncExternalStore } from "react";
import { ACCESSORIES, arcAccessory } from "./arcAccessories";

interface Props {
  disabled?: boolean;
}

// Sits next to Arc in the map corner, beside the colour picker. The choice is saved in the browser.
export default function ArcAccessoryPicker({ disabled }: Props) {
  const accessory = useSyncExternalStore(arcAccessory.subscribe, arcAccessory.get, () => null);

  return (
    <select
      aria-label="Arc's accessory"
      title="Dress Arc up"
      disabled={disabled}
      value={accessory ?? ""}
      onChange={(e) => arcAccessory.set(e.target.value || null)}
      className="cursor-pointer rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-muted shadow-sm hover:text-text disabled:cursor-default"
    >
      <option value="">No accessory</option>
      {ACCESSORIES.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  );
}
