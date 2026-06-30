import { assert, assertEquals } from "./assert.ts";
import { decideSeatItemUpdate } from "../_shared/billing-logic.ts";

// Branch matrix: (seatItemExists, N) → Stripe subscriptions.update items payload.
// Hard rule: never quantity:0 — removal uses { deleted: true }.

Deno.test("decideSeatItemUpdate: exists & N>0 → update quantity", () => {
  const r = decideSeatItemUpdate({ seatItemId: "si_1", seatPriceId: "price_seat_m", extraSeats: 3 });
  assertEquals(r, { kind: "update", items: [{ id: "si_1", quantity: 3 }] });
});

Deno.test("decideSeatItemUpdate: exists & N==0 → remove via deleted:true (never quantity:0)", () => {
  const r = decideSeatItemUpdate({ seatItemId: "si_1", seatPriceId: "price_seat_m", extraSeats: 0 });
  assertEquals(r, { kind: "remove", items: [{ id: "si_1", deleted: true }] });
});

Deno.test("decideSeatItemUpdate: !exists & N>0 → add the seat price line", () => {
  const r = decideSeatItemUpdate({ seatItemId: null, seatPriceId: "price_seat_m", extraSeats: 2 });
  assertEquals(r, { kind: "add", items: [{ price: "price_seat_m", quantity: 2 }] });
});

Deno.test("decideSeatItemUpdate: !exists & N==0 → noop", () => {
  const r = decideSeatItemUpdate({ seatItemId: null, seatPriceId: "price_seat_m", extraSeats: 0 });
  assertEquals(r, { kind: "noop" });
});

Deno.test("decideSeatItemUpdate: never emits quantity:0 in any branch", () => {
  for (const exists of [true, false]) {
    for (const n of [0, 1, 5]) {
      const r = decideSeatItemUpdate({
        seatItemId: exists ? "si_1" : null,
        seatPriceId: "price_seat_m",
        extraSeats: n,
      });
      if ("items" in r) {
        for (const it of r.items) {
          assert(!("quantity" in it && it.quantity === 0), "must never emit quantity:0");
        }
      }
    }
  }
});

Deno.test("seat_occupancy_locked migration: lock + correct columns (invites uses conta_id, not workspace_id)", async () => {
  const raw = await Deno.readTextFile(
    new URL("../../migrations/20260630000005_seat_occupancy_locked.sql", import.meta.url).pathname,
  );
  const sql = raw.replace(/\s+/g, " ");

  // Same advisory lock as enforce_plan_count_limit: hashtext(ws::text || ':' || 'max_team_members')
  assert(
    /pg_advisory_xact_lock\(\s*hashtext\(\s*ws_id::text\s*\|\|\s*':max_team_members'\s*\)\s*\)/.test(sql),
    "seat_occupancy_locked must lock hashtext(ws_id::text || ':max_team_members')",
  );

  // workspace_members IS keyed on workspace_id.
  assert(/workspace_members\s+where\s+workspace_id\s*=\s*ws_id/.test(sql),
    "must count workspace_members on workspace_id");

  // invites is keyed on conta_id — NOT workspace_id. This catches the wrong column red-before-green.
  assert(/invites[\s\S]*conta_id/.test(sql),
    "must count invites on conta_id (the invites table has no workspace_id column)");
  assert(!/invites\s+where\s+workspace_id/.test(sql),
    "must NOT reference a non-existent invites.workspace_id column");
  assert(/'pending'/.test(sql), "must count only pending invites");
});
