import { assert, assertEquals } from "./assert.ts";
import { computeInviteFlags } from "../platform-admin/invites-enrich.ts";

Deno.test("computeInviteFlags flags an add-direct (accepted_at ~= created_at) as silent_add", () => {
  const f = computeInviteFlags({
    status: "accepted",
    created_at: "2026-07-21T15:58:06.000Z",
    accepted_at: "2026-07-21T15:58:05.900Z",
  });
  assertEquals(f.silent_add, true);
  assertEquals(f.link_expired, false);
});

Deno.test("computeInviteFlags does NOT flag a normal accepted invite as silent_add", () => {
  const f = computeInviteFlags({
    status: "accepted",
    created_at: "2026-07-21T15:46:22.000Z",
    accepted_at: "2026-07-21T15:47:09.000Z", // 47s later
  });
  assertEquals(f.silent_add, false);
});

Deno.test("computeInviteFlags marks a pending invite link expired 24h after its OWN created_at", () => {
  const now = new Date("2026-07-23T13:00:00.000Z").getTime();
  const f = computeInviteFlags(
    { status: "pending", created_at: "2026-07-21T12:00:00.000Z", accepted_at: null }, // >24h old
    now,
  );
  assertEquals(f.link_expired, true);
});

Deno.test("computeInviteFlags: a recently-created pending invite is not expired", () => {
  const now = new Date("2026-07-23T13:00:00.000Z").getTime();
  const f = computeInviteFlags(
    { status: "pending", created_at: "2026-07-23T12:00:00.000Z", accepted_at: null }, // 1h old
    now,
  );
  assertEquals(f.link_expired, false);
});
