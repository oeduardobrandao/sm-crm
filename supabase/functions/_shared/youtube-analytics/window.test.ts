import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addDays, laDate, laDayStartIso, parseYtWindowRequest, resolveYtWindow } from "./window.ts";

const params = (q: string) => new URLSearchParams(q);
// 12:00 UTC on 2026-10-30 = 05:00 PDT on 2026-10-30.
const NOW = new Date("2026-10-30T12:00:00.000Z");

Deno.test("parseYtWindowRequest: no params defaults to 28 days", () => {
  assertEquals(parseYtWindowRequest(params("")), { days: 28 });
});

Deno.test("parseYtWindowRequest: days accepts only 7, 28 and 90", () => {
  assertEquals(parseYtWindowRequest(params("days=7")), { days: 7 });
  assertEquals(parseYtWindowRequest(params("days=28")), { days: 28 });
  assertEquals(parseYtWindowRequest(params("days=90")), { days: 90 });
  for (const bad of ["0", "1", "30", "365", "1.5", "abc", "-7", ""]) {
    assertEquals(parseYtWindowRequest(params(`days=${bad}`)), null, `days=${bad}`);
  }
});

Deno.test("parseYtWindowRequest: start&end must both be valid, ordered and at most 365 days", () => {
  assertEquals(parseYtWindowRequest(params("start=2026-10-01&end=2026-10-10")), { start: "2026-10-01", end: "2026-10-10" });
  assertEquals(parseYtWindowRequest(params("start=2026-10-01")), null);
  assertEquals(parseYtWindowRequest(params("end=2026-10-01")), null);
  assertEquals(parseYtWindowRequest(params("start=2026-10-10&end=2026-10-01")), null);
  assertEquals(parseYtWindowRequest(params("start=2026-02-30&end=2026-03-10")), null);
  assertEquals(parseYtWindowRequest(params("start=nope&end=2026-03-10")), null);
  // 365 days inclusive is accepted, 366 is not.
  assertEquals(parseYtWindowRequest(params("start=2026-01-01&end=2026-12-31")), { start: "2026-01-01", end: "2026-12-31" });
  assertEquals(parseYtWindowRequest(params("start=2026-01-01&end=2027-01-01")), null);
  // Mixing days with a range is not a valid request.
  assertEquals(parseYtWindowRequest(params("days=28&start=2026-10-01&end=2026-10-10")), null);
});

Deno.test("resolveYtWindow: ?days=28 with data_through three days back is a full 28-day window ending there", () => {
  // LA today is 2026-10-30; data_through is three days back.
  const r = resolveYtWindow({ days: 28 }, "2026-10-27", NOW);
  assertEquals(r.hasData, true);
  assertEquals(r.window, {
    start: "2026-09-30",
    end: "2026-10-27",
    prevStart: "2026-09-02",
    prevEnd: "2026-09-29",
  });
});

Deno.test("resolveYtWindow: ?days=7 previous window crosses a year boundary", () => {
  assertEquals(resolveYtWindow({ days: 7 }, "2026-01-03", NOW).window, {
    start: "2025-12-28",
    end: "2026-01-03",
    prevStart: "2025-12-21",
    prevEnd: "2025-12-27",
  });
});

Deno.test("resolveYtWindow: a range is clipped to data_through and the previous window has the clipped length", () => {
  const r = resolveYtWindow({ start: "2026-10-01", end: "2026-10-30" }, "2026-10-27", NOW);
  assertEquals(r.hasData, true);
  assertEquals(r.window, { start: "2026-10-01", end: "2026-10-27", prevStart: "2026-09-04", prevEnd: "2026-09-30" });
});

Deno.test("resolveYtWindow: a range ending before data_through is kept as is", () => {
  assertEquals(resolveYtWindow({ start: "2026-10-01", end: "2026-10-10" }, "2026-10-27", NOW).window, {
    start: "2026-10-01",
    end: "2026-10-10",
    prevStart: "2026-09-21",
    prevEnd: "2026-09-30",
  });
});

Deno.test("resolveYtWindow: a range entirely after data_through has no data and keeps the requested window", () => {
  const r = resolveYtWindow({ start: "2026-10-28", end: "2026-10-30" }, "2026-10-27", NOW);
  assertEquals(r.hasData, false);
  assertEquals(r.window, { start: "2026-10-28", end: "2026-10-30", prevStart: "2026-10-25", prevEnd: "2026-10-27" });
});

Deno.test("resolveYtWindow: data_through null (first sync) has no data, window anchored at the LA today", () => {
  const r = resolveYtWindow({ days: 7 }, null, NOW);
  assertEquals(r.hasData, false);
  assertEquals(r.window, { start: "2026-10-24", end: "2026-10-30", prevStart: "2026-10-17", prevEnd: "2026-10-23" });
});

Deno.test("laDate is the America/Los_Angeles calendar day", () => {
  // 03:00 UTC on the 30th is still the 29th in Los Angeles (PDT, UTC-7).
  assertEquals(laDate(new Date("2026-10-30T03:00:00.000Z")), "2026-10-29");
  assertEquals(laDate(new Date("2026-10-30T08:00:00.000Z")), "2026-10-30");
  // PST (UTC-8) in January.
  assertEquals(laDate(new Date("2026-01-15T07:59:00.000Z")), "2026-01-14");
  assertEquals(laDate(new Date("2026-01-15T08:00:00.000Z")), "2026-01-15");
});

Deno.test("laDayStartIso is the LA midnight in UTC, following DST", () => {
  assertEquals(laDayStartIso("2026-07-01"), "2026-07-01T07:00:00.000Z");
  assertEquals(laDayStartIso("2026-01-15"), "2026-01-15T08:00:00.000Z");
  // DST starts 2026-03-08 at 02:00 local: midnight that day is still PST.
  assertEquals(laDayStartIso("2026-03-08"), "2026-03-08T08:00:00.000Z");
  assertEquals(laDayStartIso("2026-03-09"), "2026-03-09T07:00:00.000Z");
  // DST ends 2026-11-01 at 02:00 local: midnight that day is still PDT.
  assertEquals(laDayStartIso("2026-11-01"), "2026-11-01T07:00:00.000Z");
  assertEquals(laDayStartIso("2026-11-02"), "2026-11-02T08:00:00.000Z");
});

Deno.test("addDays crosses months and years", () => {
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});
