import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isStaleUnit, portfolioDataThrough } from "./portfolio.ts";

const NOW = new Date("2026-10-30T15:00:00.000Z"); // SP 12:00 on 2026-10-30
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

Deno.test("isStaleUnit: an active unit last synced more than 48 h ago is stale", () => {
  assertEquals(isStaleUnit({ status: "active", last_synced_at: hoursAgo(49) }, NOW), true);
  assertEquals(isStaleUnit({ status: "active", last_synced_at: hoursAgo(47) }, NOW), false);
  assertEquals(isStaleUnit({ status: "active", last_synced_at: null }, NOW), false);
  assertEquals(isStaleUnit({ status: "revoked", last_synced_at: hoursAgo(72) }, NOW), false);
});

Deno.test("portfolioDataThrough: a stale active unit does not move the window end", () => {
  assertEquals(
    portfolioDataThrough([
      { status: "active", data_through: "2026-10-27", last_synced_at: hoursAgo(2) },
      { status: "active", data_through: "2026-10-20", last_synced_at: hoursAgo(72) },
    ], NOW),
    "2026-10-27",
  );
});

Deno.test("portfolioDataThrough: every active unit stale falls back to windowDataThrough", () => {
  assertEquals(
    portfolioDataThrough([
      { status: "active", data_through: "2026-10-27", last_synced_at: hoursAgo(60) },
      { status: "active", data_through: "2026-10-20", last_synced_at: hoursAgo(72) },
    ], NOW),
    "2026-10-20",
  );
});

Deno.test("portfolioDataThrough: a revoked unit is ignored when a fresh active unit exists", () => {
  assertEquals(
    portfolioDataThrough([
      { status: "revoked", data_through: "2026-10-01", last_synced_at: hoursAgo(700) },
      { status: "active", data_through: "2026-10-27", last_synced_at: hoursAgo(2) },
    ], NOW),
    "2026-10-27",
  );
});
