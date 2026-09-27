// Fallback places for location search when the online geocoder is unavailable.
// [west, south, east, north] boxes for states, points for towns.
export interface Place {
  name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
}

export const PLACES: Place[] = [
  { name: "South Carolina", center: [-80.9, 33.8], bbox: [-83.35, 32.03, -78.54, 35.22] },
  { name: "Georgia", center: [-83.4, 32.7], bbox: [-85.61, 30.36, -80.84, 35.0] },
  { name: "Aiken, SC", center: [-81.72, 33.56] },
  { name: "Beaufort, SC", center: [-80.67, 32.43] },
  { name: "Bluffton, SC", center: [-80.86, 32.24] },
  { name: "Charleston, SC", center: [-79.93, 32.78] },
  { name: "Columbia, SC", center: [-81.03, 34.0] },
  { name: "Florence, SC", center: [-79.76, 34.2] },
  { name: "Greenville, SC", center: [-82.39, 34.85] },
  { name: "Hardeeville, SC", center: [-81.08, 32.29] },
  { name: "Hilton Head Island, SC", center: [-80.75, 32.22] },
  { name: "James Island, SC", center: [-79.95, 32.72] },
  { name: "Jasper County, SC", center: [-81.02, 32.43] },
  { name: "Myrtle Beach, SC", center: [-78.89, 33.69] },
  { name: "North Augusta, SC", center: [-81.97, 33.5] },
  { name: "Okatie, SC", center: [-80.93, 32.32] },
  { name: "Rock Hill, SC", center: [-81.03, 34.92] },
  { name: "Albany, GA", center: [-84.16, 31.58] },
  { name: "Athens, GA", center: [-83.38, 33.95] },
  { name: "Atlanta, GA", center: [-84.39, 33.75] },
  { name: "Augusta, GA", center: [-81.97, 33.47] },
  { name: "Brunswick, GA", center: [-81.49, 31.15] },
  { name: "Columbus, GA", center: [-84.99, 32.46] },
  { name: "Evans, GA", center: [-82.13, 33.53] },
  { name: "Jesup, GA", center: [-81.89, 31.61] },
  { name: "Ludowici, GA", center: [-81.74, 31.71] },
  { name: "Macon, GA", center: [-83.63, 32.84] },
  { name: "Savannah, GA", center: [-81.1, 32.08] },
  { name: "Thurmond Dam (Clarks Hill Lake)", center: [-82.2, 33.66] },
  { name: "Tifton, GA", center: [-83.51, 31.45] },
];

export function matchPlaces(query: string, limit = 6): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = PLACES.filter((p) => p.name.toLowerCase().startsWith(q));
  const contains = PLACES.filter((p) => !starts.includes(p) && p.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}
