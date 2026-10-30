import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { minDataThrough, parseWindowRequest, resolveWindow } from "./window.ts";

const NOW = new Date("2026-10-30T15:00:00.000Z"); // SP 12:00 on 2026-10-30

const params = (q: string) => new URLSearchParams(q);

Deno.test("parseWindowRequest: days is one of 7, 30, 90; absent defaults to 30", () => {
  assertEquals(parseWindowRequest(params("")), { kind: "days", days: 30 });
  for (const d of [7, 30, 90]) assertEquals(parseWindowRequest(params(`days=${d}`)), { kind: "days", days: d });
  for (const d of ["0", "28", "91", "1.5", "abc", "-7", ""]) assertEquals(parseWindowRequest(params(`days=${d}`)), null, d);
});

Deno.test("parseWindowRequest: a range needs both ends, real dates, start <= end and at most 548 days", () => {
  assertEquals(parseWindowRequest(params("start=2026-10-01&end=2026-10-10")), {
    kind: "range",
    start: "2026-10-01",
    end: "2026-10-10",
  });
  assertEquals(parseWindowRequest(params("start=2026-10-01")), null);
  assertEquals(parseWindowRequest(params("end=2026-10-01")), null);
  assertEquals(parseWindowRequest(params("start=2026-10-10&end=2026-10-01")), null);
  assertEquals(parseWindowRequest(params("start=2026-02-30&end=2026-03-10")), null);
  // 2025-04-30 .. 2026-10-30 is 549 days inclusive; 2025-05-01 .. is 548.
  assertEquals(parseWindowRequest(params("start=2025-05-01&end=2026-10-30"))?.kind, "range");
  assertEquals(parseWindowRequest(params("start=2025-04-30&end=2026-10-30")), null);
});

Deno.test("resolveWindow: ?days ends on data_through, not today, with an abutting previous window", () => {
  assertEquals(resolveWindow({ kind: "days", days: 30 }, "2026-10-27", NOW), {
    window: { start: "2026-09-28", end: "2026-10-27", prevStart: "2026-08-29", prevEnd: "2026-09-27" },
    hasData: true,
  });
});

Deno.test("resolveWindow: a range end is clipped to data_through and the previous window has the clipped length", () => {
  assertEquals(resolveWindow({ kind: "range", start: "2026-10-21", end: "2026-10-30" }, "2026-10-25", NOW), {
    window: { start: "2026-10-21", end: "2026-10-25", prevStart: "2026-10-16", prevEnd: "2026-10-20" },
    hasData: true,
  });
  // A range ending before data_through is kept as is.
  assertEquals(resolveWindow({ kind: "range", start: "2026-10-01", end: "2026-10-10" }, "2026-10-25", NOW).window, {
    start: "2026-10-01",
    end: "2026-10-10",
    prevStart: "2026-09-21",
    prevEnd: "2026-09-30",
  });
});

Deno.test("resolveWindow: a range wholly after data_through has no data and keeps the requested window", () => {
  assertEquals(resolveWindow({ kind: "range", start: "2026-10-26", end: "2026-10-29" }, "2026-10-25", NOW), {
    window: { start: "2026-10-26", end: "2026-10-29", prevStart: "2026-10-22", prevEnd: "2026-10-25" },
    hasData: false,
  });
});

Deno.test("resolveWindow: before the first sync the window is a placeholder ending on SP yesterday", () => {
  assertEquals(resolveWindow({ kind: "days", days: 7 }, null, NOW), {
    window: { start: "2026-10-23", end: "2026-10-29", prevStart: "2026-10-16", prevEnd: "2026-10-22" },
    hasData: false,
  });
  assertEquals(resolveWindow({ kind: "range", start: "2026-10-01", end: "2026-10-10" }, null, NOW).hasData, false);
});

Deno.test("minDataThrough: the earliest watermark; units never synced are left out", () => {
  assertEquals(minDataThrough([{ data_through: "2026-10-27" }, { data_through: "2026-10-25" }]), "2026-10-25");
  assertEquals(minDataThrough([{ data_through: null }, { data_through: "2026-10-27" }]), "2026-10-27");
  assertEquals(minDataThrough([{ data_through: null }]), null);
  assertEquals(minDataThrough([]), null);
});
