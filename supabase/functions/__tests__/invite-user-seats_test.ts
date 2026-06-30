import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seatsAvailable } from "../invite-user/seats.ts";

Deno.test("seatsAvailable: blocks when members+pending >= limit", () => {
  assertEquals(seatsAvailable({ limit: 1, members: 1, pendingInvites: 0 }), false);
  assertEquals(seatsAvailable({ limit: 3, members: 1, pendingInvites: 1 }), true);
  assertEquals(seatsAvailable({ limit: 3, members: 2, pendingInvites: 1 }), false);
});

Deno.test("seatsAvailable: null limit = unlimited", () => {
  assertEquals(seatsAvailable({ limit: null, members: 99, pendingInvites: 5 }), true);
});

Deno.test("seatsAvailable: limit = included + purchased seats", () => {
  // included=2, purchased=1 => effective cap 3. With 2 members the 3rd member is allowed.
  assertEquals(seatsAvailable({ limit: 2 + 1, members: 2, pendingInvites: 0 }), true);
  // ...and a 3rd already-occupying seat (members+pending=3) hits the cap exactly => blocked.
  assertEquals(seatsAvailable({ limit: 2 + 1, members: 2, pendingInvites: 1 }), false);
  // included=2, purchased=0 => effective cap 2. The base floor still blocks the 3rd seat.
  assertEquals(seatsAvailable({ limit: 2 + 0, members: 2, pendingInvites: 0 }), false);
  // included=5, purchased=2 => effective cap 7. 4 members + 2 pending = 6 < 7 => allowed.
  assertEquals(seatsAvailable({ limit: 5 + 2, members: 4, pendingInvites: 2 }), true);
});
