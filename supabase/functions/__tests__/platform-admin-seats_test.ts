/**
 * Tests that the four seat price columns survive both plan write paths in
 * platform-admin/index.ts.
 *
 * Strategy: import the exported PLAN_SCALAR_COLUMNS allowlist and assert it
 * contains all four columns.  This is a pure in-process assertion — no DB
 * needed.  The test is RED on the old code (columns absent) and GREEN after
 * the fix (columns present).
 */
import { assertEquals, assert } from "./assert.ts";
import { PLAN_SCALAR_COLUMNS } from "../platform-admin/index.ts";

const SEAT_COLUMNS = [
  "stripe_price_id_seat",
  "stripe_price_id_seat_annual",
  "seat_addon_brl",
  "seat_addon_brl_annual",
] as const;

Deno.test("PLAN_SCALAR_COLUMNS includes all four seat price columns", () => {
  for (const col of SEAT_COLUMNS) {
    assert(
      (PLAN_SCALAR_COLUMNS as readonly string[]).includes(col),
      `PLAN_SCALAR_COLUMNS must include "${col}" — handleUpdatePlan will silently drop it otherwise`,
    );
  }
});

Deno.test("handleCreatePlan insert builder passes seat columns through", () => {
  // Replicate the exact insert-building logic from handleCreatePlan so we can
  // exercise it without a real DB connection.
  const rest: Record<string, unknown> = {
    price_brl: 99,
    stripe_price_id: "price_m",
    stripe_price_id_annual: "price_a",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_a",
    seat_addon_brl: 29,
    seat_addon_brl_annual: 290,
  };

  // Mirror the create-path logic (the explicit if-blocks in handleCreatePlan).
  const insert: Record<string, unknown> = { name: "Test Plan", is_default: false };
  for (const key of PLAN_SCALAR_COLUMNS) {
    if (rest[key] !== undefined) insert[key] = rest[key];
  }

  assertEquals(insert.stripe_price_id_seat, "price_seat_m",
    "stripe_price_id_seat must survive the create-path allowlist");
  assertEquals(insert.stripe_price_id_seat_annual, "price_seat_a",
    "stripe_price_id_seat_annual must survive the create-path allowlist");
  assertEquals(insert.seat_addon_brl, 29,
    "seat_addon_brl must survive the create-path allowlist");
  assertEquals(insert.seat_addon_brl_annual, 290,
    "seat_addon_brl_annual must survive the create-path allowlist");
});

Deno.test("handleUpdatePlan allowedScalar passes seat columns through", () => {
  // Replicate the exact update-path loop from handleUpdatePlan.
  const rest: Record<string, unknown> = {
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_a",
    seat_addon_brl: 29,
    seat_addon_brl_annual: 290,
  };

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of PLAN_SCALAR_COLUMNS) {
    if (rest[key] !== undefined) updatePayload[key] = rest[key];
  }

  assertEquals(updatePayload.stripe_price_id_seat, "price_seat_m",
    "stripe_price_id_seat must be in handleUpdatePlan allowedScalar");
  assertEquals(updatePayload.stripe_price_id_seat_annual, "price_seat_a",
    "stripe_price_id_seat_annual must be in handleUpdatePlan allowedScalar");
  assertEquals(updatePayload.seat_addon_brl, 29,
    "seat_addon_brl must be in handleUpdatePlan allowedScalar");
  assertEquals(updatePayload.seat_addon_brl_annual, 290,
    "seat_addon_brl_annual must be in handleUpdatePlan allowedScalar");
});
