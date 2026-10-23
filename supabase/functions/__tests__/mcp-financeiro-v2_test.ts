// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { fakeServer, has, insertPayload, makeDeps, makeFakeDb, rpcArgs } from "./mcp-financeiro-helpers.ts";
import { z } from "npm:zod@3";
import { REGISTERED } from "../mcp/register.ts";
import { registerFinanceiroTools } from "../mcp/financeiro-tools.ts";

type Q = Record<string, { data: unknown; error: unknown }[]>;

const V2_WRITE_TOOLS = [
  "seed_financeiro_v2",
  "save_financeiro_config",
  "save_funcao",
  "delete_funcao",
  "save_acordo",
  "save_atribuicoes",
  "save_entregas",
  "fechar_periodo",
  "reabrir_periodo",
];

function setup(responses: Q = {}, rpc: Q = {}, ctx: Record<string, unknown> = {}) {
  const { db, calls } = makeFakeDb(responses, rpc);
  const server = fakeServer();
  registerFinanceiroTools(server, makeDeps(db, ctx));
  return { server, calls };
}

const CTX = { conta_id: "workspace-B", created_by: "u-9" };
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const ok = (data: unknown) => ({ data, error: null });
const err = (message: string, code = "P0001") => ({ data: null, error: { message, code } });
const eq = (col: string, v: unknown) => [col, v];

// ---- registration and gates -------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: every v2 write tool is financeiro:write and ownerOnly", () => {
  setup();
  for (const name of V2_WRITE_TOOLS) {
    const t = REGISTERED.find((x) => x.name === name);
    assert(t, `${name} registered`);
    assertEquals(t!.scope, "financeiro:write");
    assert(t!.ownerOnly, `${name} ownerOnly`);
  }
});

Deno.test("mcp-financeiro-v2: a non-owner never reaches the db", async () => {
  const { server, calls } = setup({}, {}, { role: "admin" });
  for (const name of V2_WRITE_TOOLS) {
    const r = await server.handlers[name]({ membro_id: 1, inicio: "2026-11-01", periodo_dia: 5, nome: "x", funcao_id: 1 });
    assert(r.isError === true, `${name} refused`);
  }
  assertEquals(calls.length, 0);
});

Deno.test("mcp-financeiro-v2: v2 off refuses before any RPC or query", async () => {
  for (const name of V2_WRITE_TOOLS) {
    const { server, calls } = setup({}, {
      effective_plan_feature: [ok(true), ok(false)],
    });
    const r = await server.handlers[name]({
      membro_id: 1, inicio: "2026-11-01", periodo_dia: 5, nome: "x", funcao_id: 1, modelo: "mensal_meta", valor: 1,
      mudancas: [{ membro_id: 1, cliente_id: 2, ativo: true }], itens: [{ cliente_id: 2, quantidade: 1 }],
    });
    assert(r.isError === true, `${name} refused`);
    assertEquals(parse(r).error, "O Financeiro v2 não está ativo neste workspace.");
    assertEquals(calls.filter((c) => c.table !== "rpc:effective_plan_feature").length, 0, `${name} touched the db`);
  }
});

// ---- seed / config / funcoes ------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: seed_financeiro_v2 calls the _as RPC with ctx and returns the closed result", async () => {
  const { server, calls } = setup({}, { financeiro_seed_as: [ok({ seeded: true, ja_existia: false, extra: "x" })] }, CTX);
  const r = await server.handlers["seed_financeiro_v2"]({ periodo_dia: 5 });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_seed_as"), { p_conta: "workspace-B", p_user: "u-9", p_periodo_dia: 5 });
  assertEquals(parse(r), { seeded: true, ja_existia: false });
});

Deno.test("mcp-financeiro-v2: save_financeiro_config maps omitted fields to null and needs at least one", async () => {
  const { server, calls } = setup({}, { financeiro_config_salvar_as: [ok(null)] }, CTX);
  const r = await server.handlers["save_financeiro_config"]({ meta_margem: 60 });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_config_salvar_as"), {
    p_conta: "workspace-B", p_user: "u-9", p_periodo_dia: null, p_meta_margem: 60,
  });
  const empty = setup({}, {}, CTX);
  const r2 = await empty.server.handlers["save_financeiro_config"]({});
  assert(r2.isError === true);
  assertEquals(empty.calls.filter((c) => c.table !== "rpc:effective_plan_feature").length, 0);
});

Deno.test("mcp-financeiro-v2: save_funcao creates (id null) and updates, returning funcao_id", async () => {
  const a = setup({}, { financeiro_funcao_salvar_as: [ok(12)] }, CTX);
  const r = await a.server.handlers["save_funcao"]({ nome: "Design" });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(a.calls, "financeiro_funcao_salvar_as"), {
    p_conta: "workspace-B", p_user: "u-9", p_id: null, p_nome: "Design", p_ordem: null,
  });
  assertEquals(parse(r), { funcao_id: 12 });
  const row = insertPayload(a.calls, "audit_log") as Record<string, any>;
  assertEquals(row.metadata.args, { funcao_id: 12 });

  const b = setup({}, { financeiro_funcao_salvar_as: [ok(5)] }, CTX);
  await b.server.handlers["save_funcao"]({ funcao_id: 5, nome: "Edição", ordem: 2 });
  const p = rpcArgs(b.calls, "financeiro_funcao_salvar_as")!;
  assertEquals([p.p_id, p.p_nome, p.p_ordem], [5, "Edição", 2]);
});

Deno.test("mcp-financeiro-v2: save_funcao maps funcao_duplicada", async () => {
  const { server } = setup({}, { financeiro_funcao_salvar_as: [err("funcao_duplicada")] });
  const r = await server.handlers["save_funcao"]({ nome: "Design" });
  assert(r.isError === true);
  assertEquals(parse(r).error, "Já existe uma função com esse nome.");
});

Deno.test("mcp-financeiro-v2: delete_funcao calls the _as RPC; foreign id maps to not_found", async () => {
  const a = setup({}, { financeiro_funcao_excluir_as: [ok(null)] }, CTX);
  const r = await a.server.handlers["delete_funcao"]({ funcao_id: 5 });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(a.calls, "financeiro_funcao_excluir_as"), { p_conta: "workspace-B", p_user: "u-9", p_id: 5 });
  assertEquals(parse(r), { ok: true });

  const b = setup({}, { financeiro_funcao_excluir_as: [err("not_found", "P0002")] });
  const r2 = await b.server.handlers["delete_funcao"]({ funcao_id: 99 });
  assertEquals(parse(r2).error, "Registro não encontrado neste workspace.");
});

// ---- save_acordo ------------------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: save_acordo fills omitted keys with null and keeps arquivo_path", async () => {
  const { server, calls } = setup(
    {
      membros: [ok({ id: 4 })],
      financeiro_periodos: [ok({ inicio: "2026-11-01" })],
      financeiro_acordo_versoes: [ok({ arquivo_path: "workspace-B/4/abc.pdf" })],
    },
    { financeiro_acordo_salvar_as: [ok(null)] },
    CTX,
  );
  const r = await server.handlers["save_acordo"]({ membro_id: 4, modelo: "por_entrega", valor: 2500 });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_acordo_salvar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_membro_id: 4,
    p_vale_desde: "2026-11-01",
    p_acordo: {
      funcao_id: null,
      modelo: "por_entrega",
      valor: 2500,
      unidade: null,
      meta_quantidade: null,
      meta_periodo: null,
      limite_clientes: null,
      dia_pagamento: null,
      vigencia_inicio: null,
      vigencia_fim: null,
      arquivo_path: "workspace-B/4/abc.pdf",
    },
  });
  // member checked against the workspace; current version = latest vale_desde <= target, same workspace
  assert(has(calls, "membros", "eq", eq("conta_id", "workspace-B")));
  assert(has(calls, "financeiro_acordo_versoes", "eq", eq("conta_id", "workspace-B")));
  assert(has(calls, "financeiro_acordo_versoes", "eq", eq("membro_id", 4)));
  assert(has(calls, "financeiro_acordo_versoes", "lte", ["vale_desde", "2026-11-01"]));
  assert(has(calls, "financeiro_acordo_versoes", "order", ["vale_desde", { ascending: false }]));
  // the contract path never leaves in the result
  assert(!r.content[0].text.includes("abc.pdf"));
  assertEquals(parse(r), { ok: true, membro_id: 4, vale_desde: "2026-11-01" });
});

Deno.test("mcp-financeiro-v2: save_acordo sends every given field for mensal_meta and null arquivo_path when there is no version", async () => {
  const { server, calls } = setup(
    { membros: [ok({ id: 4 })], financeiro_acordo_versoes: [ok(null)] },
    { financeiro_acordo_salvar_as: [ok(null)] },
  );
  const r = await server.handlers["save_acordo"]({
    membro_id: 4, vale_desde: "2026-10-05", funcao_id: 3, modelo: "mensal_meta", valor: 40, unidade: "reel",
    meta_quantidade: 8, meta_periodo: "semana", limite_clientes: 6, dia_pagamento: 5,
    vigencia_inicio: "2026-10-01", vigencia_fim: "2027-09-30",
  });
  assert(!r.isError, r.content[0].text);
  const a = rpcArgs(calls, "financeiro_acordo_salvar_as")!;
  assertEquals(a.p_vale_desde, "2026-10-05");
  // limite_clientes does not belong to mensal_meta: nulled like the CRM dialog does
  assertEquals(a.p_acordo, {
    funcao_id: 3, modelo: "mensal_meta", valor: 40, unidade: "reel", meta_quantidade: 8, meta_periodo: "semana",
    limite_clientes: null, dia_pagamento: 5, vigencia_inicio: "2026-10-01", vigencia_fim: "2027-09-30", arquivo_path: null,
  });
  assert(!calls.some((c) => c.table === "financeiro_periodos"), "explicit vale_desde skips the open-period lookup");
});

Deno.test("mcp-financeiro-v2: save_acordo nulls the fields that do not belong to the model", async () => {
  const mk = () =>
    setup(
      { membros: [ok({ id: 4 })], financeiro_acordo_versoes: [ok(null)] },
      { financeiro_acordo_salvar_as: [ok(null)] },
    );
  const extras = {
    membro_id: 4, vale_desde: "2026-10-05", valor: 10, unidade: "reel", meta_quantidade: 8, meta_periodo: "mes",
    limite_clientes: 6,
  };
  const a = mk();
  await a.server.handlers["save_acordo"]({ ...extras, modelo: "mensal_limite" });
  const pa = rpcArgs(a.calls, "financeiro_acordo_salvar_as")!.p_acordo as any;
  assertEquals([pa.unidade, pa.meta_quantidade, pa.meta_periodo, pa.limite_clientes], [null, null, null, 6]);

  const b = mk();
  await b.server.handlers["save_acordo"]({ ...extras, modelo: "por_entrega" });
  const pb = rpcArgs(b.calls, "financeiro_acordo_salvar_as")!.p_acordo as any;
  assertEquals([pb.unidade, pb.meta_quantidade, pb.meta_periodo, pb.limite_clientes], [null, null, null, null]);
});

Deno.test("mcp-financeiro-v2: save_acordo applies the CRM rules before any acordo read or RPC", async () => {
  const base = { membro_id: 4, vale_desde: "2026-10-05", valor: 10 };
  const cases: Record<string, unknown>[] = [
    { ...base, modelo: "mensal_meta" },
    { ...base, modelo: "mensal_meta", meta_quantidade: 0 },
    { ...base, modelo: "mensal_limite" },
    { ...base, modelo: "mensal_limite", limite_clientes: 0, meta_quantidade: 5 },
    { ...base, modelo: "por_entrega", vigencia_inicio: "2026-10-10", vigencia_fim: "2026-10-09" },
  ];
  for (const args of cases) {
    const { server, calls } = setup({ membros: [ok({ id: 4 })] }, { financeiro_acordo_salvar_as: [ok(null)] });
    const r = await server.handlers["save_acordo"](args);
    assert(r.isError === true, JSON.stringify(args));
    assertEquals(parse(r).error, "Acordo inválido. Confira modelo, valor, meta e limite de clientes.");
    assert(!calls.some((c) => c.table === "rpc:financeiro_acordo_salvar_as"), JSON.stringify(args));
    assert(!calls.some((c) => c.table === "financeiro_acordo_versoes"), JSON.stringify(args));
  }
});

Deno.test("mcp-financeiro-v2: save_acordo for a foreign membro is not_found before any write", async () => {
  const { server, calls } = setup({ membros: [ok(null)] }, { financeiro_acordo_salvar_as: [ok(null)] });
  const r = await server.handlers["save_acordo"]({ membro_id: 99, vale_desde: "2026-11-01", modelo: "por_entrega", valor: 1 });
  assert(r.isError === true);
  assertEquals(parse(r).error, "Registro não encontrado neste workspace.");
  assert(!calls.some((c) => c.table === "rpc:financeiro_acordo_salvar_as"));
  assert(!calls.some((c) => c.table === "financeiro_acordo_versoes"));
});

Deno.test("mcp-financeiro-v2: save_acordo rejects impossible dates and maps acordo_invalido / periodo_fechado", async () => {
  const a = setup({ membros: [ok({ id: 4 })] });
  const r = await a.server.handlers["save_acordo"]({ membro_id: 4, vale_desde: "2026-02-30", modelo: "por_entrega", valor: 1 });
  assert(r.isError === true);
  assert(!a.calls.some((c) => c.table === "rpc:financeiro_acordo_salvar_as"));

  const b = setup({ membros: [ok({ id: 4 })] });
  const r1 = await b.server.handlers["save_acordo"]({
    membro_id: 4, vale_desde: "2026-11-01", modelo: "por_entrega", valor: 1, vigencia_fim: "2026-13-40",
  });
  assert(r1.isError === true);

  for (const code of ["acordo_invalido", "periodo_fechado"]) {
    const c = setup(
      { membros: [ok({ id: 4 })], financeiro_acordo_versoes: [ok(null)] },
      { financeiro_acordo_salvar_as: [err(code)] },
    );
    const r2 = await c.server.handlers["save_acordo"]({ membro_id: 4, vale_desde: "2026-11-01", modelo: "por_entrega", valor: 1 });
    assert(r2.isError === true);
    assert(!parse(r2).error.includes("Internal"), code);
  }
});

Deno.test("mcp-financeiro-v2: save_acordo schema validates modelo, meta_periodo, dia and valor", () => {
  const { server } = setup();
  const shape = z.object(server.shapes["save_acordo"] as z.ZodRawShape);
  const base = { membro_id: 1, modelo: "por_entrega", valor: 1 };
  assert(shape.safeParse(base).success);
  assert(!shape.safeParse({ ...base, meta_quantidade: 0 }).success);
  assert(!shape.safeParse({ ...base, limite_clientes: 0 }).success);
  assert(shape.safeParse({ ...base, unidade: "x".repeat(100) }).success);
  assert(!shape.safeParse({ ...base, modelo: "outro" }).success);
  assert(!shape.safeParse({ ...base, valor: -1 }).success);
  assert(!shape.safeParse({ ...base, meta_periodo: "ano" }).success);
  assert(!shape.safeParse({ ...base, dia_pagamento: 32 }).success);
  assert(shape.safeParse({ ...base, dia_pagamento: null, funcao_id: null, unidade: null }).success);
});

// ---- save_atribuicoes -------------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: save_atribuicoes sends only the three keys and defaults vale_desde", async () => {
  const { server, calls } = setup(
    { financeiro_periodos: [ok({ inicio: "2026-11-01" })] },
    { financeiro_atribuicoes_salvar_as: [ok(null)] },
    CTX,
  );
  const r = await server.handlers["save_atribuicoes"]({
    mudancas: [{ membro_id: 1, cliente_id: 2, ativo: true, extra: "x" }, { membro_id: 1, cliente_id: 3, ativo: false }],
  });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_atribuicoes_salvar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_vale_desde: "2026-11-01",
    p_mudancas: [
      { membro_id: 1, cliente_id: 2, ativo: true },
      { membro_id: 1, cliente_id: 3, ativo: false },
    ],
  });
  assertEquals(parse(r), { ok: true, vale_desde: "2026-11-01", mudancas: 2 });
  const row = insertPayload(calls, "audit_log") as Record<string, any>;
  assertEquals(row.metadata.args, { vale_desde: "2026-11-01", count: 2 });
});

Deno.test("mcp-financeiro-v2: save_atribuicoes uses an explicit vale_desde and maps cliente_encerrado", async () => {
  const { server, calls } = setup({}, { financeiro_atribuicoes_salvar_as: [err("cliente_encerrado")] });
  const r = await server.handlers["save_atribuicoes"]({
    vale_desde: "2026-10-01", mudancas: [{ membro_id: 1, cliente_id: 2, ativo: true }],
  });
  assert(r.isError === true);
  assertEquals(parse(r).error, "O cliente está encerrado e não pode receber atribuição.");
  assertEquals(rpcArgs(calls, "financeiro_atribuicoes_salvar_as")!.p_vale_desde, "2026-10-01");
  assert(!calls.some((c) => c.table === "financeiro_periodos"));
});

Deno.test("mcp-financeiro-v2: save_atribuicoes and save_entregas bound the list at 200", () => {
  const { server } = setup();
  const at = z.object(server.shapes["save_atribuicoes"] as z.ZodRawShape);
  const m = { membro_id: 1, cliente_id: 2, ativo: true };
  assert(!at.safeParse({ mudancas: [] }).success);
  assert(at.safeParse({ mudancas: Array(200).fill(m) }).success);
  assert(!at.safeParse({ mudancas: Array(201).fill(m) }).success);
  const en = z.object(server.shapes["save_entregas"] as z.ZodRawShape);
  const it = { cliente_id: 2, quantidade: 1 };
  assert(!en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: [] }).success);
  assert(en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: Array(200).fill(it) }).success);
  assert(!en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: Array(201).fill(it) }).success);
  assert(en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: [{ cliente_id: 2, quantidade: null }] }).success);
  assert(!en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: [{ cliente_id: 2, quantidade: -1 }] }).success);
  assert(!en.safeParse({ inicio: "2026-11-01", membro_id: 1, itens: [{ cliente_id: 2, quantidade: 2.5 }] }).success);
});

// ---- save_entregas ----------------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: save_entregas maps the items and audits counts only", async () => {
  const { server, calls } = setup({}, { financeiro_entregas_salvar_as: [ok(null)] }, CTX);
  const r = await server.handlers["save_entregas"]({
    inicio: "2026-11-01", membro_id: 4, itens: [{ cliente_id: 2, quantidade: 5 }, { cliente_id: 3, quantidade: null }],
  });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_entregas_salvar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_inicio: "2026-11-01",
    p_membro_id: 4,
    p_itens: [{ cliente_id: 2, quantidade: 5 }, { cliente_id: 3, quantidade: null }],
  });
  const row = insertPayload(calls, "audit_log") as Record<string, any>;
  assertEquals(row.metadata.args, { inicio: "2026-11-01", membro_id: 4, count: 2 });
  assert(!JSON.stringify(row.metadata).includes("quantidade"));
});

Deno.test("mcp-financeiro-v2: save_entregas maps sem_atribuicao and rejects an impossible inicio", async () => {
  const a = setup({}, { financeiro_entregas_salvar_as: [err("sem_atribuicao")] });
  const r = await a.server.handlers["save_entregas"]({ inicio: "2026-11-01", membro_id: 4, itens: [{ cliente_id: 2, quantidade: 1 }] });
  assertEquals(parse(r).error, "O membro não está atribuído a esse cliente no período.");

  const b = setup();
  const r2 = await b.server.handlers["save_entregas"]({ inicio: "2026-02-31", membro_id: 4, itens: [{ cliente_id: 2, quantidade: 1 }] });
  assert(r2.isError === true);
  assert(!b.calls.some((c) => c.table === "rpc:financeiro_entregas_salvar_as"));
});

// ---- fechar / reabrir -------------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: fechar_periodo and reabrir_periodo call their _as RPCs with ctx", async () => {
  const { server, calls } = setup(
    {},
    { financeiro_periodo_fechar_as: [ok(null)], financeiro_periodo_reabrir_as: [ok(null)] },
    CTX,
  );
  const f = await server.handlers["fechar_periodo"]({ inicio: "2026-10-01" });
  assert(!f.isError, f.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_periodo_fechar_as"), { p_conta: "workspace-B", p_user: "u-9", p_inicio: "2026-10-01" });
  assertEquals(parse(f), { ok: true, inicio: "2026-10-01" });
  const r = await server.handlers["reabrir_periodo"]({ inicio: "2026-10-01" });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_periodo_reabrir_as"), { p_conta: "workspace-B", p_user: "u-9", p_inicio: "2026-10-01" });
  const rows = calls.filter((c) => c.table === "audit_log" && c.method === "insert").map((c) => (c.args[0] as any).metadata.args);
  assertEquals(rows, [{ inicio: "2026-10-01" }, { inicio: "2026-10-01" }]);
});

Deno.test("mcp-financeiro-v2: periodo_fechado and periodo_estado_invalido map to Portuguese", async () => {
  const a = setup({}, { financeiro_periodo_fechar_as: [err("periodo_estado_invalido")] });
  const r = await a.server.handlers["fechar_periodo"]({ inicio: "2026-10-01" });
  assertEquals(parse(r).error, "O período não está no estado necessário para esta operação.");

  const b = setup({}, { financeiro_entregas_salvar_as: [err("periodo_fechado")] });
  const r2 = await b.server.handlers["save_entregas"]({ inicio: "2026-10-01", membro_id: 4, itens: [{ cliente_id: 2, quantidade: 1 }] });
  assertEquals(parse(r2).error, "Este período está fechado. Reabra o período antes de alterar.");
});

// ---- audit ------------------------------------------------------------------------------------

Deno.test("mcp-financeiro-v2: save_acordo audit carries ids and vale_desde only", async () => {
  const { server, calls } = setup(
    { membros: [ok({ id: 4 })], financeiro_acordo_versoes: [ok(null)] },
    { financeiro_acordo_salvar_as: [ok(null)] },
  );
  await server.handlers["save_acordo"]({
    membro_id: 4, vale_desde: "2026-11-01", modelo: "por_entrega", valor: 98765, unidade: "SEGREDO",
  });
  const row = insertPayload(calls, "audit_log") as Record<string, any>;
  assertEquals(row.metadata.args, { membro_id: 4, vale_desde: "2026-11-01" });
  assert(!JSON.stringify(row.metadata).includes("98765"));
  assert(!JSON.stringify(row.metadata).includes("SEGREDO"));
  assertEquals(row.resource_id, "4");
});

Deno.test("mcp-financeiro-v2: config and funcao audits carry no valores or names", async () => {
  const a = setup({}, { financeiro_config_salvar_as: [ok(null)] });
  await a.server.handlers["save_financeiro_config"]({ periodo_dia: 7, meta_margem: 61.5 });
  const row = insertPayload(a.calls, "audit_log") as Record<string, any>;
  assert(!JSON.stringify(row.metadata).includes("61.5"));

  const b = setup({}, { financeiro_funcao_salvar_as: [ok(3)] });
  await b.server.handlers["save_funcao"]({ nome: "SEGREDO" });
  assert(!JSON.stringify(insertPayload(b.calls, "audit_log")).includes("SEGREDO"));
});
