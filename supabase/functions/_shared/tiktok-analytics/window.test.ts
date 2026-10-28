import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { spDayEndExclusiveIso, spDayStartIso, windowFromDays, windowFromRange } from "./window.ts";

Deno.test("windowFromDays(30) ends on the SP today and the previous window abuts the start", () => {
  assertEquals(windowFromDays(30, new Date("2026-10-28T12:00:00Z")), {
    start: "2026-09-29",
    end: "2026-10-28",
    prevStart: "2026-08-30",
    prevEnd: "2026-09-28",
  });
});

Deno.test("windowFromDays uses the SP date: 01:30Z on the 29th is still the 28th", () => {
  assertEquals(windowFromDays(7, new Date("2026-10-29T01:30:00Z")).end, "2026-10-28");
});

Deno.test("windowFromDays(1) is a single day", () => {
  assertEquals(windowFromDays(1, new Date("2026-10-28T12:00:00Z")), {
    start: "2026-10-28",
    end: "2026-10-28",
    prevStart: "2026-10-27",
    prevEnd: "2026-10-27",
  });
});

Deno.test("windowFromRange builds the previous window of the same length", () => {
  assertEquals(windowFromRange("2026-10-01", "2026-10-10"), {
    start: "2026-10-01",
    end: "2026-10-10",
    prevStart: "2026-09-21",
    prevEnd: "2026-09-30",
  });
});

Deno.test("windowFromRange crosses a year boundary", () => {
  assertEquals(windowFromRange("2026-01-01", "2026-01-31")?.prevStart, "2025-12-01");
});

Deno.test("windowFromRange rejects an inverted range", () => {
  assertEquals(windowFromRange("2026-10-10", "2026-10-01"), null);
});

Deno.test("windowFromRange rejects malformed or impossible dates", () => {
  assertEquals(windowFromRange("2026-10-1", "2026-10-10"), null);
  assertEquals(windowFromRange("nope", "2026-10-10"), null);
  assertEquals(windowFromRange("2026-02-30", "2026-03-10"), null);
});

Deno.test("windowFromRange rejects spans over 730 days and accepts exactly 730", () => {
  // 2026-01-01 + 729 days = 2027-12-31 (730 days inclusive).
  assertEquals(windowFromRange("2026-01-01", "2027-12-31")?.end, "2027-12-31");
  assertEquals(windowFromRange("2026-01-01", "2028-01-01"), null);
  // 731-day span.
  assertEquals(windowFromRange("2026-01-01", "2028-01-01"), null);
});

Deno.test("spDayStartIso / spDayEndExclusiveIso are the SP midnight in UTC", () => {
  assertEquals(spDayStartIso("2026-10-28"), "2026-10-28T03:00:00.000Z");
  assertEquals(spDayEndExclusiveIso("2026-10-28"), "2026-10-29T03:00:00.000Z");
  assertEquals(spDayEndExclusiveIso("2026-12-31"), "2027-01-01T03:00:00.000Z");
});
