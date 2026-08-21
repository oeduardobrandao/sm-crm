import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseClientId, parseGenerateBody } from "./client-id.ts";

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

// req.json() aceita qualquer JSON válido -- não só objetos. Um corpo `null`,
// `5` ou `"x"` faz `.clientId` lançar TypeError antes de chegar em
// parseClientId; o catch externo do index.ts converteria isso num 500
// genérico em vez do 400 invalid_body pretendido (achado do review externo).
Deno.test("parseGenerateBody rejeita corpo JSON não-objeto (null, número, string, array)", () => {
  assertEquals(parseGenerateBody(null), null);
  assertEquals(parseGenerateBody(5), null);
  assertEquals(parseGenerateBody("x"), null);
  assertEquals(parseGenerateBody(true), null);
  assertEquals(parseGenerateBody([1, 2, 3]), null);
});

Deno.test("parseGenerateBody rejeita objeto sem clientId válido", () => {
  assertEquals(parseGenerateBody({}), null);
  assertEquals(parseGenerateBody({ clientId: true }), null);
  assertEquals(parseGenerateBody({ clientId: "5" }), null);
  assertEquals(parseGenerateBody({ clientId: 0 }), null);
});

Deno.test("parseGenerateBody aceita objeto com clientId válido e normaliza month", () => {
  assertEquals(parseGenerateBody({ clientId: 5, month: "2026-08" }), {
    clientId: 5,
    month: "2026-08",
  });
  assertEquals(parseGenerateBody({ clientId: 5 }), { clientId: 5, month: "" });
});
