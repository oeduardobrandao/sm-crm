import { assertEquals } from "./assert.ts";
import { computeEmProducaoByPost, type StatusEventRow } from "../hub-posts/em-producao.ts";

let seq = 0;
function ev(post_id: number, from_status: string | null, to_status: string, minute: number): StatusEventRow {
  seq += 1;
  return {
    id: seq,
    post_id,
    from_status,
    to_status,
    created_at: `2026-09-20T10:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

Deno.test("em_producao: re-arm (aprovado_cliente -> rascunho) is proxima_aprovacao", () => {
  const out = computeEmProducaoByPost([
    ev(1, "aprovado_interno", "enviado_cliente", 1),
    ev(1, "enviado_cliente", "aprovado_cliente", 2),
    ev(1, "aprovado_cliente", "rascunho", 3),
  ]);
  assertEquals(out.get(1), "proxima_aprovacao");
});

Deno.test("em_producao: correction rework (correcao_cliente -> revisao_interna) is correcao", () => {
  const out = computeEmProducaoByPost([
    ev(2, "aprovado_interno", "enviado_cliente", 1),
    ev(2, "enviado_cliente", "correcao_cliente", 2),
    ev(2, "correcao_cliente", "revisao_interna", 3),
  ]);
  assertEquals(out.get(2), "correcao");
});

Deno.test("em_producao: approval invalidation (aprovado_cliente -> revisao_interna) is ajuste", () => {
  const out = computeEmProducaoByPost([
    ev(3, "aprovado_interno", "enviado_cliente", 1),
    ev(3, "enviado_cliente", "aprovado_cliente", 2),
    ev(3, "aprovado_cliente", "revisao_interna", 3),
  ]);
  assertEquals(out.get(3), "ajuste");
});

Deno.test("em_producao: a draft never sent to the client has no entry", () => {
  const out = computeEmProducaoByPost([
    ev(4, "rascunho", "revisao_interna", 1),
    ev(4, "revisao_interna", "aprovado_interno", 2),
  ]);
  assertEquals(out.has(4), false);
});

Deno.test("em_producao: the latest exit wins, whatever the input order", () => {
  const rows = [
    ev(5, "aprovado_interno", "enviado_cliente", 1),
    ev(5, "enviado_cliente", "correcao_cliente", 2),
    ev(5, "correcao_cliente", "revisao_interna", 3),
    ev(5, "aprovado_interno", "enviado_cliente", 4),
    ev(5, "enviado_cliente", "aprovado_cliente", 5),
    ev(5, "aprovado_cliente", "rascunho", 6),
  ];
  assertEquals(computeEmProducaoByPost([...rows].reverse()).get(5), "proxima_aprovacao");
});

Deno.test("em_producao: sent but no exit row recorded falls back to ajuste", () => {
  const out = computeEmProducaoByPost([ev(6, "aprovado_interno", "enviado_cliente", 1)]);
  assertEquals(out.get(6), "ajuste");
});

Deno.test("em_producao: internal -> internal moves after the exit do not change the reason", () => {
  const out = computeEmProducaoByPost([
    ev(7, "aprovado_interno", "enviado_cliente", 1),
    ev(7, "enviado_cliente", "aprovado_cliente", 2),
    ev(7, "aprovado_cliente", "rascunho", 3),
    ev(7, "rascunho", "revisao_interna", 4),
  ]);
  assertEquals(out.get(7), "proxima_aprovacao");
});
