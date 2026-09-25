import { assertEquals } from "./assert.ts";
import {
  closeInstant,
  lastDayOfMonth,
  monthRange,
  previousMonth,
  saoPauloDate,
} from "../_shared/sao-paulo-date.ts";

Deno.test("saoPauloDate: before 03:00 UTC is still the previous São Paulo day", () => {
  assertEquals(saoPauloDate(new Date("2026-09-25T02:59:59Z")), "2026-09-24");
  assertEquals(saoPauloDate(new Date("2026-09-25T03:00:00Z")), "2026-09-25");
});

Deno.test("saoPauloDate: the 02:44 UTC cron tick belongs to the previous São Paulo day", () => {
  assertEquals(saoPauloDate(new Date("2026-10-01T02:44:00Z")), "2026-09-30");
});

Deno.test("closeInstant: D at 23:44 São Paulo is D+1 02:44 UTC, across month and year ends", () => {
  assertEquals(closeInstant("2026-06-30").toISOString(), "2026-07-01T02:44:00.000Z");
  assertEquals(closeInstant("2026-12-31").toISOString(), "2027-01-01T02:44:00.000Z");
});

Deno.test("lastDayOfMonth handles February and leap years", () => {
  assertEquals(lastDayOfMonth("2026-02"), "2026-02-28");
  assertEquals(lastDayOfMonth("2028-02"), "2028-02-29");
  assertEquals(lastDayOfMonth("2026-09"), "2026-09-30");
});

Deno.test("monthRange is inclusive and crosses years; empty when from > to", () => {
  assertEquals(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assertEquals(monthRange("2026-09", "2026-09"), ["2026-09"]);
  assertEquals(monthRange("2026-10", "2026-09"), []);
});

Deno.test("previousMonth wraps the year", () => {
  assertEquals(previousMonth("2026-01"), "2025-12");
  assertEquals(previousMonth("2026-09"), "2026-08");
});
