import type { Cost as CostResult, Project } from "@/lib/data";
import { COST_PARAMS, DRAWS, TIER_SAVINGS, type TriangularRange } from "./cost-params";

export interface CostInput {
  a: Project;
  b: Project;
  tier: 1 | 2 | 3 | 4;
  distanceKm: number;
  seed?: string;
}

function randomGenerator(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sample(range: TriangularRange, random: () => number): number {
  if (range.low === range.high) return range.low;
  const split = (range.mode - range.low) / (range.high - range.low);
  const draw = random();
  return draw < split
    ? range.low + Math.sqrt(draw * (range.high - range.low) * (range.mode - range.low))
    : range.high - Math.sqrt((1 - draw) * (range.high - range.low) * (range.high - range.mode));
}

function projectCost(project: Project, random: () => number): number {
  const properties = project.properties;
  if (properties.type === "substation") {
    return sample(COST_PARAMS.substationPositionCost, random);
  }

  const voltage = properties.voltage_kv === 230 ? 230 : 115;
  const base = sample(COST_PARAMS.lineCostPerMile[voltage], random) * COST_PARAMS.projectMiles;
  return properties.type === "rebuild" || properties.type === "reconductor"
    ? base * sample(COST_PARAMS.rebuildFraction, random)
    : base;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

export function estimateCost({ a, b, tier, distanceKm, seed }: CostInput): CostResult {
  const random = randomGenerator(seed ?? `${a.properties.id}:${b.properties.id}:${tier}`);
  const tierParams = TIER_SAVINGS[tier];
  const routeMiles = distanceKm / COST_PARAMS.kilometersPerMile;
  const estimates: number[] = [];
  const trucks: number[] = [];
  const emissions: number[] = [];

  for (let draw = 0; draw < DRAWS; draw += 1) {
    const combinedCost = projectCost(a, random) + projectCost(b, random);
    const mobilization = combinedCost * 0.06;
    const rowCost = combinedCost * sample(COST_PARAMS.rowShareOfProjectCost, random);
    const savedTrips = sample(COST_PARAMS.roundTripsByTier[tier], random);
    const freightCost =
      savedTrips * routeMiles * 2 * sample(COST_PARAMS.truckCostPerMile, random);
    const outage =
      sample(COST_PARAMS.customersAffected, random) *
      sample(COST_PARAMS.outageHours, random) *
      sample(COST_PARAMS.outageCostPerCustomerHour, random);
    const equipment = sample(COST_PARAMS.equipmentDays, random) *
      sample(COST_PARAMS.equipmentCostPerDay, random);

    estimates.push(
      mobilization * sample(tierParams.mobilization, random) +
        rowCost * sample(tierParams.row, random) +
        outage * sample(tierParams.outage, random) +
        freightCost * sample(tierParams.freightShare, random) +
        (tier === 4 ? equipment : 0),
    );
    trucks.push(savedTrips);
    emissions.push(
      (savedTrips * routeMiles * 2 * COST_PARAMS.co2KgPerTruckMile) / 1_000,
    );
  }

  estimates.sort((x, y) => x - y);
  trucks.sort((x, y) => x - y);
  emissions.sort((x, y) => x - y);
  return {
    p10: Math.round(percentile(estimates, 0.1)),
    p50: Math.round(percentile(estimates, 0.5)),
    p90: Math.round(percentile(estimates, 0.9)),
    currency: "USD",
    trucks_saved: Number(percentile(trucks, 0.5).toFixed(2)),
    co2_t: Number(percentile(emissions, 0.5).toFixed(3)),
  };
}
