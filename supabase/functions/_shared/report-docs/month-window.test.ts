import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { monthWindow, prevMonthOf } from "./month-window.ts";

Deno.test("monthWindow calcula bordas e label pt-BR", () => {
  const w = monthWindow("2026-07");
  assertEquals(w.startDate, "2026-07-01");
  assertEquals(w.endDateExclusive, "2026-08-01");
  assertEquals(w.start, "2026-07-01T00:00:00.000Z");
  assertEquals(w.endExclusive, "2026-08-01T00:00:00.000Z");
  assertEquals(w.label, "Julho de 2026");
});

Deno.test("monthWindow vira o ano em dezembro", () => {
  assertEquals(monthWindow("2025-12").endDateExclusive, "2026-01-01");
});

Deno.test("prevMonthOf", () => {
  assertEquals(prevMonthOf("2026-01"), "2025-12");
  assertEquals(prevMonthOf("2026-07"), "2026-06");
});

Deno.test("monthWindow rejeita formato inválido", () => {
  let threw = false;
  try { monthWindow("2026-7"); } catch { threw = true; }
  assert(threw);
});
