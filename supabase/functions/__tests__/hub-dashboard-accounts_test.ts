import { assertEquals } from "./assert.ts";
import { followersDelta, instagramState, tiktokState } from "../hub-dashboard/accounts.ts";

const NOW = "2026-11-10T12:00:00.000Z";

Deno.test("instagramState: disconnected wins over an expired token (epoch 0)", () => {
  assertEquals(
    instagramState({ authorization_status: "disconnected", token_expires_at: "1970-01-01T00:00:00.000Z" }, NOW),
    null,
  );
});

Deno.test("instagramState: revoked and expired need reconnection", () => {
  assertEquals(instagramState({ authorization_status: "revoked", token_expires_at: null }, NOW), "needs_reconnect");
  assertEquals(instagramState({ authorization_status: "expired", token_expires_at: null }, NOW), "needs_reconnect");
});

Deno.test("instagramState: active with a past token needs reconnection; null or future token is connected", () => {
  assertEquals(
    instagramState({ authorization_status: "active", token_expires_at: "2026-11-09T00:00:00.000Z" }, NOW),
    "needs_reconnect",
  );
  assertEquals(instagramState({ authorization_status: "active", token_expires_at: null }, NOW), "connected");
  assertEquals(
    instagramState({ authorization_status: "active", token_expires_at: "2026-12-01T00:00:00.000Z" }, NOW),
    "connected",
  );
});

Deno.test("tiktokState: active, revoked/expired, disconnected", () => {
  assertEquals(tiktokState({ authorization_status: "active" }), "connected");
  assertEquals(tiktokState({ authorization_status: "expired" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "revoked" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "disconnected" }), null);
});

Deno.test("followersDelta: full window", () => {
  const d = followersDelta(
    [{ date: "2026-10-12", follower_count: 12168 }, { date: "2026-11-10", follower_count: 12480 }],
    "2026-10-11",
  );
  assertEquals(d, { value: 312, since: "2026-10-12", fullWindow: true });
});

Deno.test("followersDelta: history starts later", () => {
  const d = followersDelta(
    [{ date: "2026-10-30", follower_count: 3822 }, { date: "2026-11-09", follower_count: 3906 }],
    "2026-10-12",
  );
  assertEquals(d, { value: 84, since: "2026-10-30", fullWindow: false });
});

Deno.test("followersDelta: unsorted input, a loss, one point, points before minDate", () => {
  assertEquals(
    followersDelta(
      [{ date: "2026-11-09", follower_count: 90 }, { date: "2026-10-12", follower_count: 100 }],
      "2026-10-11",
    )?.value,
    -10,
  );
  assertEquals(followersDelta([{ date: "2026-11-09", follower_count: 90 }], "2026-10-11"), null);
  // connected 2026-11-01: the two earlier points are reconstructed and must not count
  const d = followersDelta(
    [
      { date: "2026-10-15", follower_count: 10 },
      { date: "2026-10-20", follower_count: 50 },
      { date: "2026-11-01", follower_count: 100 },
      { date: "2026-11-10", follower_count: 105 },
    ],
    "2026-10-11",
    "2026-11-01",
  );
  assertEquals(d, { value: 5, since: "2026-11-01", fullWindow: false });
});
