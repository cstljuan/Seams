export interface TriangularRange {
  low: number;
  mode: number;
  high: number;
}

export const DRAWS = 2_000;

export const COST_PARAMS = {
  projectMiles: 1,
  lineCostPerMile: {
    115: { low: 800_000, mode: 1_100_000, high: 1_500_000 },
    230: { low: 1_200_000, mode: 1_800_000, high: 2_500_000 },
  },
  rebuildFraction: { low: 0.55, mode: 0.65, high: 0.75 },
  substationPositionCost: { low: 2_000_000, mode: 3_000_000, high: 4_000_000 },
  rowShareOfProjectCost: { low: 0.15, mode: 0.25, high: 0.35 },
  truckCostPerMile: { low: 1.78, mode: 2.26, high: 2.6 },
  roundTripsByTier: {
    1: { low: 1, mode: 2, high: 3 },
    2: { low: 0.5, mode: 1, high: 1.5 },
    3: { low: 0.25, mode: 0.5, high: 1 },
    4: { low: 0, mode: 0, high: 0 },
  },
  customersAffected: { low: 500, mode: 1_000, high: 2_000 },
  outageHours: { low: 1, mode: 2, high: 4 },
  outageCostPerCustomerHour: { low: 250, mode: 370, high: 500 },
  equipmentDays: { low: 0.5, mode: 1, high: 2.5 },
  equipmentCostPerDay: { low: 600, mode: 1_000, high: 2_000 },
  co2KgPerTruckMile: 1.57,
  kilometersPerMile: 1.609344,
} as const;

export const TIER_SAVINGS = {
  1: {
    mobilization: { low: 0.7, mode: 0.85, high: 1 },
    row: { low: 0.2, mode: 0.3, high: 0.35 },
    outage: { low: 1, mode: 1, high: 1 },
    freightShare: { low: 1, mode: 1, high: 1 },
  },
  2: {
    mobilization: { low: 0.4, mode: 0.6, high: 0.8 },
    row: { low: 0.15, mode: 0.25, high: 0.3 },
    outage: { low: 0.3, mode: 0.3, high: 0.3 },
    freightShare: { low: 0.5, mode: 0.625, high: 0.75 },
  },
  3: {
    mobilization: { low: 0.15, mode: 0.3, high: 0.45 },
    row: { low: 0.05, mode: 0.05, high: 0.05 },
    outage: { low: 0, mode: 0, high: 0 },
    freightShare: { low: 0.25, mode: 0.325, high: 0.4 },
  },
  4: {
    mobilization: { low: 0.05, mode: 0.1, high: 0.15 },
    row: { low: 0, mode: 0, high: 0 },
    outage: { low: 0, mode: 0, high: 0 },
    freightShare: { low: 0, mode: 0, high: 0 },
  },
} as const;
