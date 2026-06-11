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
