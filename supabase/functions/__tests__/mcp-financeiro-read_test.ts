// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { fakeServer, has, makeDeps, makeFakeDb, rpcArgs } from "./mcp-financeiro-helpers.ts";
import type { RegisteredTool } from "../mcp/queries.ts";
import { registerTools } from "../mcp/tools.ts";
import { registerFinanceiroTools } from "../mcp/financeiro-tools.ts";
import { mesSaoPaulo } from "../mcp/financeiro.ts";

const FIN_READ_TOOLS = [
  "list_lancamentos",
  "list_recorrentes",
  "get_cobrancas",
  "get_financeiro_v2",
  "get_rentabilidade",
  "get_cliente_versoes",
  "get_acordo_versoes",
];

function setup(
  responses: Record<string, { data: unknown; error: unknown }[]> = {},
  rpc: Record<string, { data: unknown; error: unknown }[]> = {},
  ctx: Record<string, unknown> = {},
  now?: string,
) {
  const { db, calls } = makeFakeDb(responses, rpc);
  const server = fakeServer();
  const deps = makeDeps(db, ctx);
  if (now) deps.now = () => now;
  registerFinanceiroTools(server, deps);
  return { server, calls, deps };
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const eq = (col: string, v: unknown) => [col, v];

// ---- mesSaoPaulo ------------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: mesSaoPaulo uses America/Sao_Paulo, not UTC", () => {
  // 01:00Z on Dec 1 is still Nov 30 22:00 in São Paulo.
  assertEquals(mesSaoPaulo("2026-12-01T01:00:00Z"), { ano: 2026, mes: 11, primeiro: "2026-11-01", anterior: "2026-10-01" });
  assertEquals(mesSaoPaulo("2026-12-01T12:00:00Z"), { ano: 2026, mes: 12, primeiro: "2026-12-01", anterior: "2026-11-01" });
  // January wraps to December of the previous year.
  assertEquals(mesSaoPaulo("2027-01-15T12:00:00Z"), { ano: 2027, mes: 1, primeiro: "2027-01-01", anterior: "2026-12-01" });
});

// ---- registration -----------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: all financeiro tools are ownerOnly", () => {
  const { db } = makeFakeDb({});
  const server = fakeServer();
  const registry: RegisteredTool[] = [];
  registerTools(server, makeDeps(db, {}, registry));
  const fin = registry.filter((t) => t.scope.startsWith("financeiro:"));
  assert(fin.length >= FIN_READ_TOOLS.length, "financeiro tools are registered by registerTools");
  for (const name of FIN_READ_TOOLS) {
    const t = fin.find((x) => x.name === name);
    assert(t, `${name} registered`);
    assertEquals(t!.scope, "financeiro:read");
  }
  for (const t of fin) assert(t.ownerOnly, `${t.name} must be ownerOnly`);
});

Deno.test("mcp-financeiro-read: a non-owner never reaches the db", async () => {
  const { server, calls } = setup({}, {}, { role: "admin" });
  for (const name of FIN_READ_TOOLS) {
    const r = await server.handlers[name]({ cliente_id: 1, membro_id: 1 });
    assert(r.isError === true, `${name} refused`);
  }
  assertEquals(calls.length, 0);
});

const V2_READ_TOOLS = ["get_financeiro_v2", "get_rentabilidade", "get_cliente_versoes", "get_acordo_versoes"];

Deno.test("mcp-financeiro-read: v2 tools refuse before any query when feature_financeiro_v2 is off", async () => {
  for (const name of V2_READ_TOOLS) {
    const { server, calls } = setup({}, {
      effective_plan_feature: [{ data: true, error: null }, { data: false, error: null }],
    });
    const r = await server.handlers[name]({ cliente_id: 1, membro_id: 1 });
    assert(r.isError === true, `${name} refused`);
    assertEquals(parse(r).error, "O Financeiro v2 não está ativo neste workspace.");
    assertEquals(calls.filter((c) => c.table !== "rpc:effective_plan_feature").length, 0, `${name} touched the db`);
  }
});

// ---- list_lancamentos -------------------------------------------------------------------------

const TX_ROW = {
  id: 7,
  data: "2026-11-05",
  descricao: "Mensalidade X",
  detalhe: null,
  categoria: "Mensalidade",
  tipo: "entrada",
  valor: 1500,
  status: "pago",
  cliente_id: 3,
  referencia_agendamento: null,
  user_id: "secret-user",
  conta_id: "workspace-A",
  created_at: "2026-11-05T00:00:00Z",
};

Deno.test("mcp-financeiro-read: list_lancamentos filters by conta_id, month, tipo, status and allowlists fields", async () => {
  const { server, calls } = setup({ transacoes: [{ data: [TX_ROW], error: null }] });
  const r = await server.handlers["list_lancamentos"]({ mes: "2026-11", tipo: "entrada", status: "pago", limit: 50 });
  assert(!r.isError, r.content[0].text);
  const out = parse(r);
  assertEquals(Object.keys(out), ["lancamentos"]);
  assertEquals(Object.keys(out.lancamentos[0]).sort(), [
    "categoria", "cliente_id", "data", "descricao", "detalhe", "id", "referencia_agendamento", "status", "tipo", "valor",
  ]);
  assert(has(calls, "transacoes", "eq", eq("conta_id", "workspace-A")), "conta_id filter");
  assert(has(calls, "transacoes", "eq", eq("tipo", "entrada")));
  assert(has(calls, "transacoes", "eq", eq("status", "pago")));
  assert(has(calls, "transacoes", "gte", ["data", "2026-11-01"]));
  assert(has(calls, "transacoes", "lt", ["data", "2026-12-01"]));
  assert(has(calls, "transacoes", "order", ["data", { ascending: false }]));
  // Tie-break on id so "mais recentes primeiro" is deterministic within a day, after data.
  const orders = calls.filter((c) => c.table === "transacoes" && c.method === "order").map((c) => c.args);
  assertEquals(orders, [["data", { ascending: false }], ["id", { ascending: false }]]);
  assert(has(calls, "transacoes", "limit", [50]));
  const sel = calls.find((c) => c.table === "transacoes" && c.method === "select")!.args[0] as string;
  assert(!sel.includes("*") && !sel.includes("user_id") && !sel.includes("conta_id"), "closed select list");
});

Deno.test("mcp-financeiro-read: list_lancamentos defaults to limit 100 and wraps December", async () => {
  const { server, calls } = setup({ transacoes: [{ data: [], error: null }] });
  await server.handlers["list_lancamentos"]({ mes: "2026-12" });
  assert(has(calls, "transacoes", "limit", [100]));
  assert(has(calls, "transacoes", "lt", ["data", "2027-01-01"]));
});

Deno.test("mcp-financeiro-read: list_lancamentos rejects an impossible month", async () => {
  const { server, calls } = setup({});
  const r = await server.handlers["list_lancamentos"]({ mes: "2026-13" });
  assert(r.isError === true);
  assertEquals(calls.filter((c) => c.table === "transacoes").length, 0);
});

Deno.test("mcp-financeiro-read: list_lancamentos description points to get_cobrancas and list_recorrentes", () => {
  const { server } = setup();
  const d = server.descriptions["list_lancamentos"];
  assert(d.includes("get_cobrancas") && d.includes("list_recorrentes"));
});

// ---- list_recorrentes -------------------------------------------------------------------------

const REC = (id: number, fim: string | null) => ({
  id, tipo: "saida", descricao: `R${id}`, categoria: "Ferramenta", valor: 99, dia: 10, inicio: "2026-01-01", fim,
  user_id: "u", conta_id: "workspace-A", created_at: "x",
});

Deno.test("mcp-financeiro-read: list_recorrentes returns active ones by default (fim null or >= current month)", async () => {
  const rows = [REC(1, null), REC(2, "2026-11-01"), REC(3, "2026-10-01")];
  const { server, calls } = setup({ transacoes_recorrentes: [{ data: rows, error: null }] }, {}, {}, "2026-11-15T12:00:00Z");
  const out = parse(await server.handlers["list_recorrentes"]({}));
  assertEquals(out.recorrentes.map((r: any) => r.id), [1, 2]);
  assertEquals(Object.keys(out.recorrentes[0]).sort(), ["categoria", "descricao", "dia", "fim", "id", "inicio", "tipo", "valor"]);
  assert(has(calls, "transacoes_recorrentes", "eq", eq("conta_id", "workspace-A")));
});

Deno.test("mcp-financeiro-read: list_recorrentes incluir_encerrados returns all", async () => {
  const rows = [REC(1, null), REC(3, "2026-10-01")];
  const { server } = setup({ transacoes_recorrentes: [{ data: rows, error: null }] }, {}, {}, "2026-11-15T12:00:00Z");
  const out = parse(await server.handlers["list_recorrentes"]({ incluir_encerrados: true }));
  assertEquals(out.recorrentes.map((r: any) => r.id), [1, 3]);
});

// ---- get_cobrancas ----------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: get_cobrancas filters both tables by conta_id and allowlists fields", async () => {
  const { server, calls } = setup({
    clientes: [{ data: [{ id: 1, nome: "C", status: "ativo", valor_mensal: 1000, data_pagamento: 5, email: "x@y", telefone: "1" }], error: null }],
    membros: [{ data: [{ id: 2, nome: "M", custo_mensal: 500, data_pagamento: 10, email: "m@y" }], error: null }],
  });
  const out = parse(await server.handlers["get_cobrancas"]({}));
  assertEquals(Object.keys(out).sort(), ["clientes", "membros"]);
  assertEquals(out.clientes, [{ id: 1, nome: "C", status: "ativo", valor_mensal: 1000, data_pagamento: 5 }]);
  assertEquals(out.membros, [{ id: 2, nome: "M", custo_mensal: 500, data_pagamento: 10 }]);
  assert(has(calls, "clientes", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "membros", "eq", eq("conta_id", "workspace-A")));
});

// ---- get_financeiro_v2 ------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: get_financeiro_v2 reads config/funcoes by conta_id and periods through the _as RPCs", async () => {
  const periodos = [{ inicio: "2026-11-01", fim: "2026-12-01", rotulo: "Nov", status: "aberto", transicao: false }];
  const editaveis = [{ inicio: "2026-11-01", fim: "2026-12-01", rotulo: "Nov", status: "aberto", transicao: false }];
  const { server, calls } = setup(
    {
      financeiro_config: [{ data: { periodo_dia: 5, meta_margem: 55, seeded_at: "2026-10-01T00:00:00Z", conta_id: "workspace-A", created_at: "x" }, error: null }],
      financeiro_funcoes: [{ data: [{ id: 1, nome: "Design", ordem: 0, conta_id: "workspace-A", created_at: "x" }], error: null }],
    },
    {
      financeiro_periodos_listar_as: [{ data: periodos, error: null }],
      financeiro_periodos_editaveis_as: [{ data: editaveis, error: null }],
    },
  );
  const r = await server.handlers["get_financeiro_v2"]({});
  assert(!r.isError, r.content[0].text);
  const out = parse(r);
  assertEquals(Object.keys(out).sort(), ["config", "editaveis", "funcoes", "periodos"]);
  assertEquals(out.config, { periodo_dia: 5, meta_margem: 55, seeded: true });
  assertEquals(out.funcoes, [{ id: 1, nome: "Design", ordem: 0 }]);
  assertEquals(out.periodos, periodos);
  assertEquals(out.editaveis, editaveis);
  assert(has(calls, "financeiro_config", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "financeiro_funcoes", "eq", eq("conta_id", "workspace-A")));
  assertEquals(rpcArgs(calls, "financeiro_periodos_listar_as"), { p_conta: "workspace-A", p_user: "user-1" });
  assertEquals(rpcArgs(calls, "financeiro_periodos_editaveis_as"), { p_conta: "workspace-A", p_user: "user-1" });
});

Deno.test("mcp-financeiro-read: get_financeiro_v2 before the seed reports seeded=false and empty lists", async () => {
  const { server } = setup({ financeiro_config: [{ data: null, error: null }], financeiro_funcoes: [{ data: [], error: null }] });
  const out = parse(await server.handlers["get_financeiro_v2"]({}));
  assertEquals(out.config.seeded, false);
  assertEquals(out.periodos, []);
  assertEquals(out.editaveis, []);
});

Deno.test("mcp-financeiro-read: an RPC error is mapped to Portuguese", async () => {
  const { server } = setup(
    { financeiro_config: [{ data: null, error: null }], financeiro_funcoes: [{ data: [], error: null }] },
    { financeiro_periodos_listar_as: [{ data: null, error: { message: "owner_only", code: "42501" } }] },
  );
  const r = await server.handlers["get_financeiro_v2"]({});
  assert(r.isError === true);
  assert(parse(r).error.includes("dono"), parse(r).error);
});

// ---- get_rentabilidade ------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: get_rentabilidade calls the _as RPC with explicit conta/user and the period", async () => {
  const payload = { seeded: true, periodo: { inicio: "2026-11-01" } };
  const { server, calls } = setup({}, { financeiro_rentabilidade_as: [{ data: payload, error: null }] });
  const out = parse(await server.handlers["get_rentabilidade"]({ inicio: "2026-11-01" }));
  assertEquals(out, payload);
  assertEquals(rpcArgs(calls, "financeiro_rentabilidade_as"), { p_conta: "workspace-A", p_user: "user-1", p_inicio: "2026-11-01" });
});

Deno.test("mcp-financeiro-read: get_rentabilidade without inicio sends null", async () => {
  const { server, calls } = setup({}, { financeiro_rentabilidade_as: [{ data: {}, error: null }] });
  await server.handlers["get_rentabilidade"]({});
  assertEquals(rpcArgs(calls, "financeiro_rentabilidade_as"), { p_conta: "workspace-A", p_user: "user-1", p_inicio: null });
});

// ---- versoes ----------------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: get_cliente_versoes checks the cliente belongs to the workspace first", async () => {
  const { server, calls } = setup({
    clientes: [{ data: { id: 4 }, error: null }],
    financeiro_cliente_versoes: [{
      data: [{ vale_desde: "2026-11-01", valor_mensal: 1000, dia_pagamento: 5, status: "ativo", created_at: "t", created_by: "u", id: 1, conta_id: "workspace-A", cliente_id: 4 }],
      error: null,
    }],
  });
  const out = parse(await server.handlers["get_cliente_versoes"]({ cliente_id: 4 }));
  assertEquals(out.versoes, [{ vale_desde: "2026-11-01", valor_mensal: 1000, dia_pagamento: 5, status: "ativo", created_at: "t" }]);
  assert(has(calls, "clientes", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "clientes", "eq", eq("id", 4)));
  assert(has(calls, "financeiro_cliente_versoes", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "financeiro_cliente_versoes", "eq", eq("cliente_id", 4)));
  assert(has(calls, "financeiro_cliente_versoes", "order", ["vale_desde", { ascending: false }]));
  assert(has(calls, "financeiro_cliente_versoes", "limit", [50]));
  assert(
    calls.findIndex((c) => c.table === "clientes" && c.method === "from") <
      calls.findIndex((c) => c.table === "financeiro_cliente_versoes" && c.method === "from"),
    "ownership check runs first",
  );
});

Deno.test("mcp-financeiro-read: get_cliente_versoes for a foreign cliente is not_found and reads no versions", async () => {
  const { server, calls } = setup({ clientes: [{ data: null, error: null }] });
  const r = await server.handlers["get_cliente_versoes"]({ cliente_id: 99 });
  assert(r.isError === true);
  assertEquals(calls.filter((c) => c.table === "financeiro_cliente_versoes").length, 0);
});

Deno.test("mcp-financeiro-read: get_acordo_versoes exposes tem_contrato, never arquivo_path or created_by", async () => {
  const row = {
    vale_desde: "2026-11-01", funcao_id: 2, modelo: "mensal_meta", valor: 3000, unidade: null, meta_quantidade: 20,
    meta_periodo: "mes", limite_clientes: null, dia_pagamento: 5, vigencia_inicio: null, vigencia_fim: null,
    created_at: "t", arquivo_path: "ws/9/x.pdf", created_by: "u", id: 1, conta_id: "workspace-A", membro_id: 9,
  };
  const { server, calls } = setup({
    membros: [{ data: { id: 9 }, error: null }],
    financeiro_acordo_versoes: [{ data: [row, { ...row, vale_desde: "2026-10-01", arquivo_path: null }], error: null }],
  });
  const out = parse(await server.handlers["get_acordo_versoes"]({ membro_id: 9 }));
  assertEquals(out.versoes.length, 2);
  assertEquals(Object.keys(out.versoes[0]).sort(), [
    "created_at", "dia_pagamento", "funcao_id", "limite_clientes", "meta_periodo", "meta_quantidade", "modelo", "tem_contrato",
    "unidade", "vale_desde", "valor", "vigencia_fim", "vigencia_inicio",
  ]);
  assertEquals(out.versoes[0].tem_contrato, true);
  assertEquals(out.versoes[1].tem_contrato, false);
  assert(has(calls, "membros", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "membros", "eq", eq("id", 9)));
  assert(has(calls, "financeiro_acordo_versoes", "eq", eq("conta_id", "workspace-A")));
  assert(has(calls, "financeiro_acordo_versoes", "eq", eq("membro_id", 9)));
  assert(has(calls, "financeiro_acordo_versoes", "limit", [50]));
});

Deno.test("mcp-financeiro-read: get_acordo_versoes for a foreign membro is not_found", async () => {
  const { server, calls } = setup({ membros: [{ data: null, error: null }] });
  const r = await server.handlers["get_acordo_versoes"]({ membro_id: 99 });
  assert(r.isError === true);
  assertEquals(calls.filter((c) => c.table === "financeiro_acordo_versoes").length, 0);
});

// ---- audit ------------------------------------------------------------------------------------

Deno.test("mcp-financeiro-read: audit carries filters, never values", async () => {
  const { server, calls } = setup({ transacoes: [{ data: [TX_ROW], error: null }] });
  await server.handlers["list_lancamentos"]({ mes: "2026-11", tipo: "entrada" });
  const ins = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(ins, "audit insert");
  const text = JSON.stringify(ins!.args);
  assert(!text.includes("Mensalidade X") && !text.includes("1500"), "no descricao/valor in audit");
});
