/**
 * Pure seat-pricing math for the Plano & Cobrança seat selector. Kept out of the
 * component so it's unit-testable. All money is in centavos, matching
 * `plans.price_brl`. Annual ≈ 10× monthly (2 months free) — mirrors the tier rule.
 */

export interface SeatCostArgs {
  /** Tier base price for the chosen interval, in centavos. */
  basePriceCentavos: number;
  /** Seats already priced into the tier (= max_team_members). NULL = treat as 0. */
  includedSeats: number | null;
  /** Total seats the user has selected in the stepper. */
  selectedSeats: number;
  /** Per-seat add-on price in centavos (MONTHLY rate). */
  seatAddonCentavos: number;
  interval: 'month' | 'year';
}

export interface SeatCost {
  /** EXTRA seats beyond the tier base (never negative). */
  extraSeats: number;
  /** Cost of the extra seats for the interval, in centavos. */
  extraCostCentavos: number;
  /** base + extra, in centavos. */
  totalCentavos: number;
}

export function computeSeatCost(args: SeatCostArgs): SeatCost {
  const included = args.includedSeats ?? 0;
  const extraSeats = Math.max(0, args.selectedSeats - included);
  const perSeat = args.interval === 'year' ? args.seatAddonCentavos * 10 : args.seatAddonCentavos;
  const extraCostCentavos = extraSeats * perSeat;
  return {
    extraSeats,
    extraCostCentavos,
    totalCentavos: args.basePriceCentavos + extraCostCentavos,
  };
}

/**
 * Clamp a selector value to its floor: a workspace can never select fewer seats than
 * the tier includes, nor fewer than it currently has (the in-app remove path runs
 * through `billing-seats`, not the checkout selector). Floor = max(included, current).
 */
export function clampSeats(
  selected: number,
  includedSeats: number | null,
  currentSeats: number,
): number {
  const floor = Math.max(includedSeats ?? 0, currentSeats);
  return Math.max(floor, selected);
}
