import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseClientId } from "./client-id.ts";

Deno.test("parseClientId aceita inteiro positivo real", () => {
  assertEquals(parseClientId(5), 5);
  assertEquals(parseClientId(1), 1);
});

Deno.test("parseClientId rejeita boolean (Number(true) === 1 seria um bypass)", () => {
  assertEquals(parseClientId(true), null);
  assertEquals(parseClientId(false), null);
});

Deno.test("parseClientId rejeita string hex-like (Number('0x10') === 16 seria um bypass)", () => {
  assertEquals(parseClientId("0x10"), null);
  assertEquals(parseClientId("5"), null); // string numérica também: convenção é inteiro real, não string coercível
});

Deno.test("parseClientId rejeita zero, negativo, float, null, undefined e NaN", () => {
  assertEquals(parseClientId(0), null);
  assertEquals(parseClientId(-3), null);
  assertEquals(parseClientId(3.5), null);
  assertEquals(parseClientId(null), null);
  assertEquals(parseClientId(undefined), null);
  assertEquals(parseClientId(NaN), null);
});
