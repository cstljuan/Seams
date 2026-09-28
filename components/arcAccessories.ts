import { savedChoice } from "./savedChoice";

// Things Arc can wear. Drawn into Arc's own SVG (see Mascot.tsx), so they bob, tilt and squash with him.
export const ACCESSORIES = [
  { id: "hard-hat", label: "Hard hat" },
  { id: "headlamp", label: "Headlamp" },
  { id: "party-hat", label: "Party hat" },
] as const;

export type ArcAccessory = (typeof ACCESSORIES)[number]["id"];

const IDS: readonly string[] = ACCESSORIES.map((a) => a.id);

// Nothing saved means no accessory.
export const arcAccessory = savedChoice("seams.arc-accessory", (value) => IDS.includes(value));

// Colours come from app/theme.css. SVG fill attributes can't read CSS variables, but style can.
const fill = (token: string) => `style="fill:var(--${token})"`;

// Arc's head is the top edge of the bolt, from (58,26) to (142,20) in his 200x200 box.
// Each drawing uses a frame sitting on the middle of that edge: x runs along the head, y = 0 is the top.
const HEAD = `translate(100 23) rotate(-4.1)`;

// `uid` keeps gradient ids apart when more than one Arc is on the page.
export function accessorySvg(id: string | null, uid: string): string {
  switch (id) {
    case "hard-hat":
      return `<g transform="${HEAD}">
        <path d="M-31,1 C-31,-25 31,-25 31,1 Z" ${fill("arc-hat")}/>
        <rect x="-5" y="-17.5" width="10" height="18" rx="3" ${fill("arc-hat-shade")}/>
        <path d="M-22,-7 C-19,-13 -14,-16 -9,-17" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
        <rect x="-43" y="-1" width="94" height="7" rx="3.5" ${fill("arc-hat-shade")}/>
      </g>`;
    case "headlamp":
      return `<g transform="${HEAD}">
        <defs><linearGradient id="${uid}beam" x1="0" x2="1">
          <stop offset="0" stop-opacity=".6" ${stop("arc-lamp")}/>
          <stop offset="1" stop-opacity="0" ${stop("arc-lamp")}/>
        </linearGradient></defs>
        <path d="M44,3 L120,-22 L120,40 L44,13 Z" fill="url(#${uid}beam)"/>
        <rect x="-43" y="4" width="86" height="7" rx="2" ${fill("arc-gear")}/>
        <circle cx="38" cy="7.5" r="9.5" ${fill("arc-gear")}/>
        <circle cx="39.5" cy="7.5" r="5.5" ${fill("arc-lamp")}/>
      </g>`;
    case "party-hat":
      return `<g transform="${HEAD} translate(10 1) rotate(14)">
        <path d="M-15,0 L15,0 L0,-38 Z" ${fill("arc-party")}/>
        <circle cx="-4" cy="-9" r="2.8" ${fill("arc-party-dots")}/>
        <circle cx="5" cy="-17" r="2.5" ${fill("arc-party-dots")}/>
        <circle cx="-1" cy="-26" r="2.1" ${fill("arc-party-dots")}/>
        <circle cx="0" cy="-40" r="5.5" ${fill("arc-party-dots")}/>
      </g>`;
    default:
      return "";
  }
}

function stop(token: string) {
  return `style="stop-color:var(--${token})"`;
}
