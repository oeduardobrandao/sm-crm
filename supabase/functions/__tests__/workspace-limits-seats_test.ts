import { assertEquals } from "./assert.ts";
import { buildSeatsBlock } from "../workspace-limits/seats-block.ts";

Deno.test("buildSeatsBlock: included base + purchased + effective from RPC; used = members + pending", () => {
  assertEquals(
    buildSeatsBlock({
      includedSeats: 2,
      purchasedSeats: 1,
      effectiveSeats: 3,
      members: 2,
      pendingInvites: 1,
    }),
    { included: 2, purchased: 1, effective: 3, used: 3 },
  );
});

Deno.test("buildSeatsBlock: unlimited tier keeps included/effective null, purchased still surfaced", () => {
  assertEquals(
    buildSeatsBlock({
      includedSeats: null,
      purchasedSeats: 0,
      effectiveSeats: null,
      members: 5,
      pendingInvites: 0,
    }),
    { included: null, purchased: 0, effective: null, used: 5 },
  );
});

Deno.test("buildSeatsBlock: coerces nullish member/invite counts to 0", () => {
  assertEquals(
    buildSeatsBlock({
      includedSeats: 5,
      purchasedSeats: 0,
      effectiveSeats: 5,
      members: 0,
      pendingInvites: 0,
    }),
    { included: 5, purchased: 0, effective: 5, used: 0 },
  );
});
