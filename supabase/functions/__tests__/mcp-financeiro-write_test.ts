// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { fakeServer, has, insertPayload, makeDeps, makeFakeDb, rpcArgs, updatePayload } from "./mcp-financeiro-helpers.ts";
import { z } from "npm:zod@3";
import { REGISTERED } from "../mcp/register.ts";
import { registerFinanceiroTools } from "../mcp/financeiro-tools.ts";

type Q = Record<string, { data: unknown; error: unknown }[]>;

const WRITE_TOOLS = [
  "create_lancamento",
  "update_lancamento",
  "delete_lancamento",
  "confirmar_agendamento",
  "create_recorrente",
  "update_recorrente",
  "encerrar_recorrente",
  "set_cobranca_cliente",
  "set_custo_membro",
];

function setup(responses: Q = {}, rpc: Q = {}, ctx: Record<string, unknown> = {}, now?: string) {
  const { db, calls } = makeFakeDb(responses, rpc);
  const server = fakeServer();
  const deps = makeDeps(db, ctx);
  if (now) deps.now = () => now;
  registerFinanceiroTools(server, deps);
  return { server, calls, deps };
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const eq = (col: string, v: unknown) => [col, v];
const ok = (data: unknown) => ({ data, error: null });
const err = (message: string, code = "P0001") => ({ data: null, error: { message, code } });
const callsOn = (calls: { table: string }[], prefix: string) => calls.filter((c) => c.table === prefix);

const TX_ROW = {
  id: 11,
  data: "2026-11-05",
  descricao: "Hospedagem",
  detalhe: null,
  categoria: "Ferramenta",
  tipo: "saida",
  valor: 80,
  status: "pago",
  cliente_id: null,
  referencia_agendamento: null,
  user_id: "u-9",
  conta_id: "workspace-B",
  created_at: "2026-11-05T00:00:00Z",
};

// ---- registration -----------------------------------------------------------------------------

Deno.test("mcp-financeiro-write: every write tool is financeiro:write and ownerOnly", () => {
  setup();
  for (const name of WRITE_TOOLS) {
    const t = REGISTERED.find((x) => x.name === name);
    assert(t, `${name} registered`);
    assertEquals(t!.scope, "financeiro:write");
    assert(t!.ownerOnly, `${name} ownerOnly`);
  }
});

Deno.test("mcp-financeiro-write: a non-owner never reaches the db", async () => {
  const { server, calls } = setup({}, {}, { role: "admin" });
  for (const name of WRITE_TOOLS) {
    const r = await server.handlers[name]({ lancamento_id: 1, recorrente_id: 1, cliente_id: 1, membro_id: 1, origem: "cliente", id: 1 });
    assert(r.isError === true, `${name} refused`);
  }
  assertEquals(calls.length, 0);
});

// ---- create_lancamento ------------------------------------------------------------------------

Deno.test("mcp-financeiro-write: writes use ctx.conta_id and user_id = created_by", async () => {
  const { server, calls } = setup(
    { transacoes: [ok(TX_ROW)] },
    {},
    { conta_id: "workspace-B", created_by: "u-9", key_id: "key-1" },
  );
  const r = await server.handlers["create_lancamento"]({
    tipo: "saida",
    descricao: "Hospedagem",
    valor: 80,
    data: "2026-11-05",
    categoria: "Ferramenta",
  });
  assert(!r.isError, r.content[0].text);
  assertEquals(insertPayload(calls, "transacoes"), {
    conta_id: "workspace-B",
    user_id: "u-9",
    tipo: "saida",
    descricao: "Hospedagem",
    valor: 80,
    data: "2026-11-05",
    categoria: "Ferramenta",
    status: "pago",
    detalhe: null,
    cliente_id: null,
    referencia_agendamento: null,
  });
  // the returned row is the allowlist, never user_id/conta_id/created_at
  assertEquals(Object.keys(parse(r)).sort(), [
    "categoria", "cliente_id", "data", "descricao", "detalhe", "id", "referencia_agendamento", "status", "tipo", "valor",
  ]);
});

Deno.test("mcp-financeiro-write: foreign cliente_id refused", async () => {
  // the clientes lookup (filtered by conta_id) finds nothing
  const { server, calls } = setup({ clientes: [ok(null)] });
  const r = await server.handlers["create_lancamento"]({
    tipo: "entrada",
    descricao: "X",
    valor: 10,
    data: "2026-11-05",
    categoria: "Mensalidade",
    cliente_id: 999,
  });
  assert(r.isError === true);
  assert(parse(r).error.includes("não encontrado"), r.content[0].text);
  assert(has(calls, "clientes", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "clientes", "eq", eq("id", 999)));
  assert(!calls.some((c) => c.table === "transacoes"), "no transacoes call at all");
});

Deno.test("mcp-financeiro-write: create_lancamento with an own cliente_id inserts it", async () => {
  const { server, calls } = setup({ clientes: [ok({ id: 3 })], transacoes: [ok({ ...TX_ROW, cliente_id: 3 })] });
  const r = await server.handlers["create_lancamento"]({
    tipo: "entrada",
    descricao: "Mensalidade X",
    valor: 1500,
    data: "2026-11-05",
    categoria: "Mensalidade",
    status: "agendado",
    detalhe: "nota",
    cliente_id: 3,
  });
  assert(!r.isError, r.content[0].text);
  const p = insertPayload(calls, "transacoes")!;
  assertEquals(p.cliente_id, 3);
  assertEquals(p.status, "agendado");
  assertEquals(p.detalhe, "nota");
});

Deno.test("mcp-financeiro-write: create_lancamento rejects an impossible date before any query", async () => {
  const { server, calls } = setup();
  const r = await server.handlers["create_lancamento"]({
    tipo: "saida", descricao: "X", valor: 1, data: "2026-02-30", categoria: "Outro",
  });
  assert(r.isError === true);
  assert(parse(r).error.includes("Data inválida"), r.content[0].text);
  assertEquals(calls.filter((c) => c.table === "transacoes").length, 0);
});

// ---- update / delete lancamento ---------------------------------------------------------------

Deno.test("mcp-financeiro-write: update_lancamento filters id and conta_id and never writes referencia_agendamento", async () => {
  const { server, calls } = setup({ transacoes: [ok(TX_ROW)] });
  const r = await server.handlers["update_lancamento"]({ lancamento_id: 11, valor: 90, referencia_agendamento: "x", user_id: "evil" });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(calls, "transacoes"), { valor: 90 });
  assert(has(calls, "transacoes", "eq", eq("id", 11)));
  assert(has(calls, "transacoes", "eq", eq("conta_id", "workspace-A")));
  assertEquals(Object.keys(parse(r)).includes("user_id"), false);
});

Deno.test("mcp-financeiro-write: update_lancamento can clear cliente_id and detalhe with null, no ownership lookup", async () => {
  const { server, calls } = setup({ transacoes: [ok(TX_ROW)] });
  const r = await server.handlers["update_lancamento"]({ lancamento_id: 11, cliente_id: null, detalhe: null });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(calls, "transacoes"), { detalhe: null, cliente_id: null });
  assert(!calls.some((c) => c.table === "clientes"), "no clientes lookup when clearing");
  // the zod schema accepts null for both
  const parsed = z.object(server.shapes["update_lancamento"] as any).safeParse({ lancamento_id: 11, cliente_id: null, detalhe: null });
  assert(parsed.success, "schema accepts null");
});

Deno.test("mcp-financeiro-write: update_lancamento zero rows → not_found", async () => {
  const { server } = setup({ transacoes: [ok(null)] });
  const r = await server.handlers["update_lancamento"]({ lancamento_id: 404, valor: 1 });
  assert(r.isError === true);
  assertEquals(parse(r).error, "Registro não encontrado neste workspace.");
});

Deno.test("mcp-financeiro-write: update_lancamento needs at least one field", async () => {
  const { server, calls } = setup();
  const r = await server.handlers["update_lancamento"]({ lancamento_id: 11 });
  assert(r.isError === true);
  assertEquals(calls.filter((c) => c.table === "transacoes").length, 0);
});

Deno.test("mcp-financeiro-write: update_lancamento checks a new cliente_id against the workspace", async () => {
  const { server, calls } = setup({ clientes: [ok(null)] });
  const r = await server.handlers["update_lancamento"]({ lancamento_id: 11, cliente_id: 999 });
  assert(r.isError === true);
  assert(!calls.some((c) => c.table === "transacoes"));
});

Deno.test("mcp-financeiro-write: delete_lancamento deletes by id + conta_id and zero rows → not_found", async () => {
  const a = setup({ transacoes: [ok([{ id: 11 }])] });
  const r = await a.server.handlers["delete_lancamento"]({ lancamento_id: 11 });
  assertEquals(parse(r), { ok: true });
  assert(has(a.calls, "transacoes", "delete", []));
  assert(has(a.calls, "transacoes", "eq", eq("id", 11)));
  assert(has(a.calls, "transacoes", "eq", eq("conta_id", "workspace-A")));

  const b = setup({ transacoes: [ok([])] });
  const r2 = await b.server.handlers["delete_lancamento"]({ lancamento_id: 12 });
  assert(r2.isError === true);
  assertEquals(parse(r2).error, "Registro não encontrado neste workspace.");
});

// ---- confirmar_agendamento --------------------------------------------------------------------

Deno.test("mcp-financeiro-write: confirmar passes origem/id to the RPC (never p_hoje) and maps ja_confirmado", async () => {
  const a = setup(
    { clientes: [ok({ id: 5 })] },
    { financeiro_agendamento_confirmar_as: [ok({ ...TX_ROW, id: 77, referencia_agendamento: "cliente_5_2026_11" })] },
    { conta_id: "workspace-B", created_by: "u-9" },
  );
  const r = await a.server.handlers["confirmar_agendamento"]({ origem: "cliente", id: 5 });
  assert(!r.isError, r.content[0].text);
  // closed field list: user_id/conta_id/created_at from the RPC row never leave
  assertEquals(Object.keys(parse(r)).sort(), [
    "categoria", "cliente_id", "data", "descricao", "detalhe", "id", "referencia_agendamento", "status", "tipo", "valor",
  ]);
  assertEquals(parse(r).id, 77);
  assertEquals(rpcArgs(a.calls, "financeiro_agendamento_confirmar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_origem: "cliente",
    p_id: 5,
  });
  assert(has(a.calls, "clientes", "eq", eq("conta_id", "workspace-B")));

  const b = setup({ clientes: [ok({ id: 5 })] }, { financeiro_agendamento_confirmar_as: [err("ja_confirmado")] });
  const r2 = await b.server.handlers["confirmar_agendamento"]({ origem: "cliente", id: 5 });
  assert(r2.isError === true);
  assertEquals(parse(r2).error, "Este agendamento já foi confirmado neste mês.");
});

Deno.test("mcp-financeiro-write: confirmar checks the id belongs to the workspace per origem", async () => {
  for (
    const [origem, table] of [["cliente", "clientes"], ["membro", "membros"], ["recorrente", "transacoes_recorrentes"]] as const
  ) {
    const { server, calls } = setup({ [table]: [ok(null)] });
    const r = await server.handlers["confirmar_agendamento"]({ origem, id: 9 });
    assert(r.isError === true, origem);
    assert(has(calls, table, "eq", eq("conta_id", "workspace-A")), origem);
    assertEquals(callsOn(calls, "rpc:financeiro_agendamento_confirmar_as").length, 0, origem);
  }
});

Deno.test("mcp-financeiro-write: confirmar maps valor_indefinido and rejects an unknown origem", async () => {
  const a = setup({ membros: [ok({ id: 2 })] }, { financeiro_agendamento_confirmar_as: [err("valor_indefinido")] });
  const r = await a.server.handlers["confirmar_agendamento"]({ origem: "membro", id: 2 });
  assert(parse(r).error.includes("valor deste agendamento"), r.content[0].text);
  const b = setup();
  const r2 = await b.server.handlers["confirmar_agendamento"]({ origem: "lead", id: 2 });
  assert(r2.isError === true);
  assertEquals(b.calls.filter((c) => c.table !== "rpc:effective_plan_feature").length, 0);
});

// ---- create_recorrente ------------------------------------------------------------------------

const REC_BASE = { tipo: "saida", descricao: "Aluguel", valor: 2000, dia: 5, categoria: "Outro" };
const REC_ROW = {
  id: 4, tipo: "saida", descricao: "Aluguel", categoria: "Outro", valor: 2000, dia: 5, inicio: "2026-11-01", fim: null,
  user_id: "u-9", conta_id: "workspace-B", created_at: "2026-11-05T00:00:00Z",
};
const REC_FIELDS = ["categoria", "descricao", "dia", "fim", "id", "inicio", "tipo", "valor"];

Deno.test("mcp-financeiro-write: create_recorrente requires data_primeiro when registrar_primeiro_pago", async () => {
  const { server, calls } = setup();
  const r = await server.handlers["create_recorrente"]({ ...REC_BASE, inicio_mes: "2026-11", registrar_primeiro_pago: true });
  assert(r.isError === true);
  assert(parse(r).error.includes("data_primeiro"), r.content[0].text);
  assertEquals(callsOn(calls, "rpc:financeiro_recorrente_criar_as").length, 0);
});

Deno.test("mcp-financeiro-write: create_recorrente refuses data_primeiro without registrar_primeiro_pago", async () => {
  const { server, calls } = setup();
  const r = await server.handlers["create_recorrente"]({ ...REC_BASE, inicio_mes: "2026-11", data_primeiro: "2026-11-05" });
  assert(r.isError === true);
  assertEquals(parse(r).error, "data_primeiro só vale com registrar_primeiro_pago.");
  assertEquals(callsOn(calls, "rpc:financeiro_recorrente_criar_as").length, 0);
});

Deno.test("mcp-financeiro-write: create_recorrente refuses data_primeiro outside inicio_mes", async () => {
  const { server, calls } = setup();
  const r = await server.handlers["create_recorrente"]({
    ...REC_BASE, inicio_mes: "2026-11", registrar_primeiro_pago: true, data_primeiro: "2026-12-05",
  });
  assert(r.isError === true);
  assertEquals(callsOn(calls, "rpc:financeiro_recorrente_criar_as").length, 0);
});

Deno.test("mcp-financeiro-write: create_recorrente calls the RPC with ctx and the first of the month", async () => {
  const { server, calls } = setup(
    {},
    { financeiro_recorrente_criar_as: [ok({ recorrente: REC_ROW, lancamento: TX_ROW })] },
    { conta_id: "workspace-B", created_by: "u-9" },
  );
  const r = await server.handlers["create_recorrente"]({
    ...REC_BASE, inicio_mes: "2026-11", registrar_primeiro_pago: true, data_primeiro: "2026-11-05",
  });
  assert(!r.isError, r.content[0].text);
  // closed output: recorrente + lancamento, no user_id/conta_id/created_at, no cliente_id on the lançamento
  const out = parse(r);
  assertEquals(Object.keys(out).sort(), ["lancamento", "recorrente"]);
  assertEquals(Object.keys(out.recorrente).sort(), REC_FIELDS);
  assertEquals(Object.keys(out.lancamento).sort(), [
    "categoria", "data", "descricao", "detalhe", "id", "referencia_agendamento", "status", "tipo", "valor",
  ]);
  assertEquals(rpcArgs(calls, "financeiro_recorrente_criar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_tipo: "saida",
    p_descricao: "Aluguel",
    p_categoria: "Outro",
    p_valor: 2000,
    p_dia: 5,
    p_inicio: "2026-11-01",
    p_registrar_primeiro_pago: true,
    p_data_primeiro: "2026-11-05",
  });
});

Deno.test("mcp-financeiro-write: create_recorrente defaults inicio_mes to the São Paulo month and skips the first payment", async () => {
  // 01:00Z on Dec 1 is still November 30 in São Paulo
  const { server, calls } = setup(
    {},
    { financeiro_recorrente_criar_as: [ok({ recorrente: { ...REC_ROW, inicio: "2026-11-01" }, lancamento: null })] },
    {},
    "2026-12-01T01:00:00Z",
  );
  const r = await server.handlers["create_recorrente"](REC_BASE);
  assert(!r.isError, r.content[0].text);
  assertEquals(parse(r).lancamento, null);
  assertEquals(Object.keys(parse(r).recorrente).sort(), REC_FIELDS);
  // the audit records the RESOLVED month, not the omitted argument
  const audit = insertPayload(calls, "audit_log") as Record<string, any>;
  assertEquals(audit.metadata.args.inicio_mes, "2026-11");
  assertEquals(audit.metadata.args.recorrente_id, 4);
  const a = rpcArgs(calls, "financeiro_recorrente_criar_as")!;
  assertEquals(a.p_inicio, "2026-11-01");
  assertEquals(a.p_registrar_primeiro_pago, false);
  assertEquals(a.p_data_primeiro, null);
});

// ---- update_recorrente / encerrar_recorrente --------------------------------------------------

Deno.test("mcp-financeiro-write: update_recorrente edits by id + conta_id; zero rows → not_found", async () => {
  const REC = { id: 4, tipo: "saida", descricao: "Aluguel", categoria: "Outro", valor: 2100, dia: 5, inicio: "2026-11-01", fim: null };
  const a = setup({ transacoes_recorrentes: [ok(REC)] });
  const r = await a.server.handlers["update_recorrente"]({ recorrente_id: 4, valor: 2100 });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(a.calls, "transacoes_recorrentes"), { valor: 2100 });
  assert(has(a.calls, "transacoes_recorrentes", "eq", eq("id", 4)));
  assert(has(a.calls, "transacoes_recorrentes", "eq", eq("conta_id", "workspace-A")));

  const b = setup({ transacoes_recorrentes: [ok(null)] });
  const r2 = await b.server.handlers["update_recorrente"]({ recorrente_id: 4, valor: 1 });
  assertEquals(parse(r2).error, "Registro não encontrado neste workspace.");

  const c = setup();
  const r3 = await c.server.handlers["update_recorrente"]({ recorrente_id: 4 });
  assert(r3.isError === true);
});

Deno.test("mcp-financeiro-write: encerrar_recorrente removes when inicio is this month", async () => {
  const { server, calls } = setup(
    { transacoes_recorrentes: [ok({ id: 4, inicio: "2026-11-01", fim: null }), ok([{ id: 4 }])] },
    {},
    {},
    "2026-11-15T12:00:00Z",
  );
  const r = await server.handlers["encerrar_recorrente"]({ recorrente_id: 4 });
  assert(!r.isError, r.content[0].text);
  assertEquals(parse(r), { acao: "removido" });
  assert(has(calls, "transacoes_recorrentes", "delete", []));
  assert(has(calls, "transacoes_recorrentes", "eq", eq("conta_id", "workspace-A")));
  assert(!calls.some((c) => c.table === "transacoes_recorrentes" && c.method === "update"));
});

Deno.test("mcp-financeiro-write: encerrar_recorrente ends on previous month otherwise", async () => {
  const { server, calls } = setup(
    { transacoes_recorrentes: [ok({ id: 4, inicio: "2026-03-01", fim: null }), ok([{ id: 4 }])] },
    {},
    {},
    "2026-11-15T12:00:00Z",
  );
  const r = await server.handlers["encerrar_recorrente"]({ recorrente_id: 4 });
  assert(!r.isError, r.content[0].text);
  assertEquals(parse(r), { acao: "encerrado", fim: "2026-10-01" });
  assertEquals(updatePayload(calls, "transacoes_recorrentes"), { fim: "2026-10-01" });
  assert(has(calls, "transacoes_recorrentes", "eq", eq("conta_id", "workspace-A")));
  assert(!calls.some((c) => c.table === "transacoes_recorrentes" && c.method === "delete"));
});

Deno.test("mcp-financeiro-write: encerrar_recorrente month boundary uses São Paulo, not UTC", async () => {
  // 01:00Z on Dec 1 is still November in São Paulo: a template starting 2026-11-01 is removed, not ended
  const { server, calls } = setup(
    { transacoes_recorrentes: [ok({ id: 4, inicio: "2026-11-01", fim: null }), ok([{ id: 4 }])] },
    {},
    {},
    "2026-12-01T01:00:00Z",
  );
  const r = await server.handlers["encerrar_recorrente"]({ recorrente_id: 4 });
  assertEquals(parse(r), { acao: "removido" });
  assert(has(calls, "transacoes_recorrentes", "delete", []));
});

Deno.test("mcp-financeiro-write: encerrar_recorrente never extends one that already ended earlier", async () => {
  const { server, calls } = setup(
    { transacoes_recorrentes: [ok({ id: 4, inicio: "2026-01-01", fim: "2026-06-01" })] },
    {},
    {},
    "2026-11-15T12:00:00Z",
  );
  const r = await server.handlers["encerrar_recorrente"]({ recorrente_id: 4 });
  assertEquals(parse(r), { acao: "encerrado", fim: "2026-06-01" });
  assert(!calls.some((c) => c.table === "transacoes_recorrentes" && (c.method === "update" || c.method === "delete")));
});

Deno.test("mcp-financeiro-write: encerrar_recorrente of another workspace's template → not_found", async () => {
  const { server, calls } = setup({ transacoes_recorrentes: [ok(null)] });
  const r = await server.handlers["encerrar_recorrente"]({ recorrente_id: 4 });
  assertEquals(parse(r).error, "Registro não encontrado neste workspace.");
  assert(has(calls, "transacoes_recorrentes", "eq", eq("conta_id", "workspace-A")));
  assert(!calls.some((c) => c.method === "delete" || c.method === "update"));
});

// ---- set_cobranca_cliente ---------------------------------------------------------------------

const CLIENTE_LEGADO = { id: 8, valor_mensal: 900, data_pagamento: 3, status: "pausado" };
const seeded = [ok({ seeded_at: "2026-10-01T00:00:00Z" })];

Deno.test("mcp-financeiro-write: cobranca keeps omitted fields", async () => {
  const { server, calls } = setup(
    {
      clientes: [ok(CLIENTE_LEGADO)],
      financeiro_config: seeded,
      financeiro_periodos: [ok({ inicio: "2026-11-01" })],
      financeiro_cliente_versoes: [ok({ vale_desde: "2026-10-01", valor_mensal: 1000, dia_pagamento: 10, status: "ativo" })],
    },
    { financeiro_cliente_salvar_as: [ok(null)] },
    { conta_id: "workspace-B", created_by: "u-9" },
  );
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 1200 });
  assert(!r.isError, r.content[0].text);
  assertEquals(rpcArgs(calls, "financeiro_cliente_salvar_as"), {
    p_conta: "workspace-B",
    p_user: "u-9",
    p_cliente_id: 8,
    p_vale_desde: "2026-11-01",
    p_valor_mensal: 1200,
    p_dia_pagamento: 10,
    p_status: "ativo",
  });
  // current version = latest vale_desde <= target, scoped to the workspace
  assert(has(calls, "financeiro_cliente_versoes", "lte", ["vale_desde", "2026-11-01"]));
  assert(has(calls, "financeiro_cliente_versoes", "eq", eq("conta_id", "workspace-B")));
  assert(has(calls, "financeiro_cliente_versoes", "eq", eq("cliente_id", 8)));
  assert(has(calls, "financeiro_cliente_versoes", "order", ["vale_desde", { ascending: false }]));
  // v2 path never touches the legacy columns
  assert(!calls.some((c) => c.table === "clientes" && c.method === "update"));
});

Deno.test("mcp-financeiro-write: cobranca explicit null dia clears it and an explicit vale_desde is the target", async () => {
  const { server, calls } = setup(
    {
      clientes: [ok(CLIENTE_LEGADO)],
      financeiro_config: seeded,
      financeiro_cliente_versoes: [ok({ vale_desde: "2026-10-01", valor_mensal: 1000, dia_pagamento: 10, status: "ativo" })],
    },
    { financeiro_cliente_salvar_as: [ok(null)] },
  );
  const r = await server.handlers["set_cobranca_cliente"]({
    cliente_id: 8, dia_pagamento: null, status: "pausado", vale_desde: "2026-10-01",
  });
  assert(!r.isError, r.content[0].text);
  const a = rpcArgs(calls, "financeiro_cliente_salvar_as")!;
  assertEquals(a.p_vale_desde, "2026-10-01");
  assertEquals(a.p_dia_pagamento, null);
  assertEquals(a.p_status, "pausado");
  assertEquals(a.p_valor_mensal, 1000);
  assertEquals(callsOn(calls, "financeiro_periodos").length, 0, "explicit vale_desde skips the open-period lookup");
});

Deno.test("mcp-financeiro-write: cobranca defaults vale_desde to the first editable period when none is open", async () => {
  const { server, calls } = setup(
    {
      clientes: [ok(CLIENTE_LEGADO)],
      financeiro_config: seeded,
      financeiro_periodos: [ok(null)],
      financeiro_cliente_versoes: [ok(null)],
    },
    {
      financeiro_periodos_editaveis_as: [ok([{ inicio: "2026-11-05", status: "futuro" }, { inicio: "2026-12-05", status: "futuro" }])],
      financeiro_cliente_salvar_as: [ok(null)],
    },
  );
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 500 });
  assert(!r.isError, r.content[0].text);
  const a = rpcArgs(calls, "financeiro_cliente_salvar_as")!;
  assertEquals(a.p_vale_desde, "2026-11-05");
  // no version yet: omitted fields fall back to the legacy columns, status never null
  assertEquals(a.p_dia_pagamento, 3);
  assertEquals(a.p_status, "pausado");
  assert(has(calls, "financeiro_periodos", "eq", eq("status", "aberto")));
});

Deno.test("mcp-financeiro-write: cobranca legacy when never seeded", async () => {
  const { server, calls } = setup({
    clientes: [ok({ id: 8 }), ok({ id: 8, status: "ativo", valor_mensal: 1200, data_pagamento: 15 })],
    financeiro_config: [ok(null)],
  });
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 1200, dia_pagamento: 15, status: "ativo" });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(calls, "clientes"), { valor_mensal: 1200, data_pagamento: 15, status: "ativo" });
  assert(has(calls, "clientes", "eq", eq("conta_id", "workspace-A")));
  assertEquals(callsOn(calls, "rpc:financeiro_cliente_salvar_as").length, 0);
  // never seeded: the v2 flag is not even consulted beyond the register gate
  assertEquals(callsOn(calls, "rpc:effective_plan_feature").length, 1);
});

Deno.test("mcp-financeiro-write: cobranca legacy when seeded but v2 flag off", async () => {
  const { server, calls } = setup(
    {
      clientes: [ok({ id: 8 }), ok({ id: 8, status: "ativo", valor_mensal: 700, data_pagamento: 3 })],
      financeiro_config: seeded,
    },
    // register gate (feature_financial) then the v2 check
    { effective_plan_feature: [ok(true), ok(false)] },
  );
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 700 });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(calls, "clientes"), { valor_mensal: 700 });
  assertEquals(callsOn(calls, "rpc:financeiro_cliente_salvar_as").length, 0);
});

Deno.test("mcp-financeiro-write: cobranca rejects vale_desde on the legacy path, before any write", async () => {
  const { server, calls } = setup({ clientes: [ok({ id: 8 })], financeiro_config: [ok(null)] });
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 1, vale_desde: "2026-11-01" });
  assert(r.isError === true);
  assert(parse(r).error.includes("vale_desde"), r.content[0].text);
  assert(!calls.some((c) => c.table === "clientes" && c.method === "update"));
});

Deno.test("mcp-financeiro-write: cobranca refuses a foreign cliente and an empty change", async () => {
  const a = setup({ clientes: [ok(null)] });
  const r = await a.server.handlers["set_cobranca_cliente"]({ cliente_id: 99, valor_mensal: 1 });
  assertEquals(parse(r).error, "Registro não encontrado neste workspace.");
  assert(has(a.calls, "clientes", "eq", eq("conta_id", "workspace-A")));
  assertEquals(callsOn(a.calls, "rpc:financeiro_cliente_salvar_as").length, 0);

  const b = setup({ clientes: [ok({ id: 8 })] });
  const r2 = await b.server.handlers["set_cobranca_cliente"]({ cliente_id: 8 });
  assert(r2.isError === true);
});

Deno.test("mcp-financeiro-write: cobranca maps RPC errors (periodo_fechado)", async () => {
  const { server } = setup(
    {
      clientes: [ok(CLIENTE_LEGADO)],
      financeiro_config: seeded,
      financeiro_cliente_versoes: [ok(null)],
    },
    { financeiro_cliente_salvar_as: [err("periodo_fechado")] },
  );
  const r = await server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 1, vale_desde: "2026-01-01" });
  assertEquals(parse(r).error, "Este período está fechado. Reabra o período antes de alterar.");
});

// ---- set_custo_membro -------------------------------------------------------------------------

Deno.test("mcp-financeiro-write: custo_membro refused with v2 on", async () => {
  const { server, calls } = setup({}, { effective_plan_feature: [ok(true), ok(true)] });
  const r = await server.handlers["set_custo_membro"]({ membro_id: 2, custo_mensal: 100 });
  assert(r.isError === true);
  assertEquals(parse(r).error, "Com o Financeiro v2 ligado, o custo vem do acordo. Use save_acordo.");
  assert(!calls.some((c) => c.table === "membros"), "no membros query");
});

Deno.test("mcp-financeiro-write: custo_membro writes the legacy columns with v2 off", async () => {
  const { server, calls } = setup(
    { membros: [ok({ id: 2 }), ok({ id: 2, custo_mensal: 100, data_pagamento: null })] },
    { effective_plan_feature: [ok(true), ok(false)] },
  );
  const r = await server.handlers["set_custo_membro"]({ membro_id: 2, custo_mensal: 100, dia_pagamento: null });
  assert(!r.isError, r.content[0].text);
  assertEquals(updatePayload(calls, "membros"), { custo_mensal: 100, data_pagamento: null });
  assert(has(calls, "membros", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "membros", "eq", eq("id", 2)));
  assertEquals(parse(r), { id: 2, custo_mensal: 100, data_pagamento: null });
});

Deno.test("mcp-financeiro-write: custo_membro refuses a foreign membro and an empty change", async () => {
  const a = setup({ membros: [ok(null)] }, { effective_plan_feature: [ok(true), ok(false)] });
  const r = await a.server.handlers["set_custo_membro"]({ membro_id: 99, custo_mensal: 1 });
  assertEquals(parse(r).error, "Registro não encontrado neste workspace.");
  assert(!a.calls.some((c) => c.table === "membros" && c.method === "update"));

  const b = setup({}, { effective_plan_feature: [ok(true), ok(false)] });
  const r2 = await b.server.handlers["set_custo_membro"]({ membro_id: 2 });
  assert(r2.isError === true);
});

// ---- audit ------------------------------------------------------------------------------------

Deno.test("mcp-financeiro-write: audit has no valor/descricao/nome", async () => {
  const { server, calls } = setup({
    transacoes: [ok({ ...TX_ROW, id: 11 })],
    audit_log: [ok(null)],
  });
  await server.handlers["create_lancamento"]({
    tipo: "saida", descricao: "SEGREDO descricao", valor: 98765, data: "2026-11-05", categoria: "Outro", detalhe: "SEGREDO detalhe",
  });
  const row = insertPayload(calls, "audit_log") as Record<string, any>;
  assert(row, "audit row written");
  assertEquals(row.action, "mcp.create_lancamento");
  const json = JSON.stringify(row.metadata);
  assert(!json.includes("SEGREDO"), json);
  assert(!json.includes("98765"), json);
  assert(!("valor" in row.metadata.args) && !("descricao" in row.metadata.args), json);
  assertEquals(row.metadata.args.lancamento_id, 11);
});

Deno.test("mcp-financeiro-write: cobranca and recorrente audits carry ids only", async () => {
  const a = setup(
    {
      clientes: [ok(CLIENTE_LEGADO)],
      financeiro_config: seeded,
      financeiro_cliente_versoes: [ok(null)],
    },
    { financeiro_cliente_salvar_as: [ok(null)] },
  );
  await a.server.handlers["set_cobranca_cliente"]({ cliente_id: 8, valor_mensal: 98765, vale_desde: "2026-11-01" });
  const row = insertPayload(a.calls, "audit_log") as Record<string, any>;
  assertEquals(row.resource_id, "8");
  assertEquals(row.metadata.args, { cliente_id: 8, vale_desde: "2026-11-01" });

  const b = setup({}, {
    financeiro_recorrente_criar_as: [ok({ recorrente: { ...REC_ROW, descricao: "SEGREDO", valor: 98765 }, lancamento: null })],
  });
  await b.server.handlers["create_recorrente"]({ ...REC_BASE, descricao: "SEGREDO", valor: 98765, inicio_mes: "2026-11" });
  const row2 = insertPayload(b.calls, "audit_log") as Record<string, any>;
  assert(!JSON.stringify(row2.metadata).includes("SEGREDO"));
  assert(!JSON.stringify(row2.metadata).includes("98765"));
  assertEquals(row2.metadata.args.recorrente_id, 4);
  assertEquals(row2.metadata.args.inicio_mes, "2026-11");
});
