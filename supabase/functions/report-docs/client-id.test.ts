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
    templateId: null,
  });
  assertEquals(parseGenerateBody({ clientId: 5 }), { clientId: 5, month: "", templateId: null });
});

Deno.test("parseGenerateBody: templateId ausente vira null", () => {
  const r = parseGenerateBody({ clientId: 1, month: "2026-07" });
  assertEquals(r, { clientId: 1, month: "2026-07", templateId: null });
});

Deno.test("parseGenerateBody: templateId uuid válido passa", () => {
  const r = parseGenerateBody({
    clientId: 1,
    month: "2026-07",
    templateId: "b3b2a6a0-1111-4222-8333-444455556666",
  });
  assertEquals(r?.templateId, "b3b2a6a0-1111-4222-8333-444455556666");
});

Deno.test("parseGenerateBody: templateId não-uuid rejeita o corpo", () => {
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "abc" }),
    null,
  );
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: 42 }),
    null,
  );
});

// Sentinela explícita do "Padrão do sistema" (achado de review externo, PR
// #379): omitido continua significando "usa o default do workspace"; "system"
// é um valor DISTINTO que pede o layout padrão do sistema mesmo quando existe
// default. Só o literal exato -- variações de caixa ou qualquer outra string
// não-uuid continuam rejeitando o corpo, igual a outros templateId inválidos.
Deno.test('parseGenerateBody: templateId "system" é aceito como sentinela distinta de ausente', () => {
  const r = parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "system" });
  assertEquals(r, { clientId: 1, month: "2026-07", templateId: "system" });
});

Deno.test('parseGenerateBody: variações de "system" (caixa ou outra string não-uuid) continuam rejeitando', () => {
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "System" }),
    null,
  );
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "SYSTEM" }),
    null,
  );
  assertEquals(
    parseGenerateBody({ clientId: 1, month: "2026-07", templateId: "system-default" }),
    null,
  );
});
