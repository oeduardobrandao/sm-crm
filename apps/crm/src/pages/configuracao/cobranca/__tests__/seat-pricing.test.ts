import { describe, it, expect } from 'vitest';
import { computeSeatCost, clampSeats } from '../seat-pricing';

describe('seat-pricing', () => {
  describe('computeSeatCost', () => {
    it('charges nothing extra when selected equals included', () => {
      const r = computeSeatCost({
        basePriceCentavos: 17900,
        includedSeats: 5,
        selectedSeats: 5,
        seatAddonCentavos: 2500,
        interval: 'month',
      });
      expect(r).toEqual({ extraSeats: 0, extraCostCentavos: 0, totalCentavos: 17900 });
    });

    it('charges the per-seat add-on for each extra seat (monthly)', () => {
      const r = computeSeatCost({
        basePriceCentavos: 17900,
        includedSeats: 5,
        selectedSeats: 8,
        seatAddonCentavos: 2500,
        interval: 'month',
      });
      // 3 extra × 2500 = 7500; total 17900 + 7500 = 25400
      expect(r).toEqual({ extraSeats: 3, extraCostCentavos: 7500, totalCentavos: 25400 });
    });

    it('multiplies the per-seat add-on by 10 for annual (2 months free)', () => {
      const r = computeSeatCost({
        basePriceCentavos: 179000,
        includedSeats: 5,
        selectedSeats: 8,
        seatAddonCentavos: 2500,
        interval: 'year',
      });
      // 3 extra × (2500 × 10) = 75000; total 179000 + 75000 = 254000
      expect(r).toEqual({ extraSeats: 3, extraCostCentavos: 75000, totalCentavos: 254000 });
    });

    it('never goes negative when selected is below included', () => {
      const r = computeSeatCost({
        basePriceCentavos: 11000,
        includedSeats: 2,
        selectedSeats: 1,
        seatAddonCentavos: 2500,
        interval: 'month',
      });
      expect(r).toEqual({ extraSeats: 0, extraCostCentavos: 0, totalCentavos: 11000 });
    });

    it('treats null includedSeats as 0 included (everything is extra)', () => {
      const r = computeSeatCost({
        basePriceCentavos: 27900,
        includedSeats: null,
        selectedSeats: 2,
        seatAddonCentavos: 2500,
        interval: 'month',
      });
      expect(r).toEqual({ extraSeats: 2, extraCostCentavos: 5000, totalCentavos: 32900 });
    });
  });

  describe('clampSeats', () => {
    it('floors at the number of included seats', () => {
      expect(clampSeats(1, 5, 0)).toBe(5);
      expect(clampSeats(6, 5, 0)).toBe(6);
    });

    it('floors at the current purchased total when it exceeds included', () => {
      // already on 7 total seats; cannot drop below current via the selector
      expect(clampSeats(4, 5, 7)).toBe(7);
      expect(clampSeats(8, 5, 7)).toBe(8);
    });

    it('treats null includedSeats as 0 for the floor', () => {
      expect(clampSeats(0, null, 0)).toBe(0);
      expect(clampSeats(0, null, 3)).toBe(3);
    });
  });
});
