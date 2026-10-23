// deno-lint-ignore-file no-explicit-any
// Consultas e escritas do Financeiro para o MCP (somente donos). Toda consulta direta filtra `conta_id = ctx.conta_id` e devolve uma lista fechada de
// campos (nada de select('*')): o service role ignora RLS, então o filtro é a barreira.
import { McpInputError } from "../_shared/mcp-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import type { Deps } from "./queries.ts";
import { FINANCEIRO_ERROS, mapFinanceiroError } from "./financeiro-errors.ts";

const SP_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (n: number) => String(n).padStart(2, "0");

/** O mês corrente em America/Sao_Paulo (nunca `Date#getMonth()`, que usa o fuso do servidor). */
export function mesSaoPaulo(nowIso: string): { ano: number; mes: number; primeiro: string; anterior: string } {
  const parts = Object.fromEntries(SP_DATE.formatToParts(new Date(nowIso)).map((p) => [p.type, p.value]));
  const ano = Number(parts.year);
  const mes = Number(parts.month);
  const prevAno = mes === 1 ? ano - 1 : ano;
  const prevMes = mes === 1 ? 12 : mes - 1;
  return {
    ano,
    mes,
    primeiro: `${ano}-${pad(mes)}-01`,
    anterior: `${prevAno}-${pad(prevMes)}-01`,
  };
}

/** Relança um erro conhecido do Financeiro em português; o resto segue como veio (vira "Internal error."). */
export function fail(error: unknown): never {
  throw mapFinanceiroError(error) ?? error;
}

const notFound = () => new McpInputError(FINANCEIRO_ERROS.not_found);

const nowIso = (d: Deps) => d.now?.() ?? new Date().toISOString();

async function rpcAs(d: Deps, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await (d.db as any).rpc(name, {
    p_conta: d.ctx.conta_id,
    p_user: d.ctx.created_by,
    ...params,
  });
  if (error) fail(error);
  return data;
}

/** Chama uma RPC `_as` do v2 com o workspace e o usuário da chave (nunca o workspace ativo do JWT). */
export const callAs = rpcAs;

// ---- lançamentos -------------------------------------------------------------------------------

const LANCAMENTO_FIELDS = [
  "id", "data", "descricao", "detalhe", "categoria", "tipo", "valor", "status", "cliente_id", "referencia_agendamento",
] as const;

export function pick<T extends Record<string, any>>(row: T, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

export async function listLancamentos(
  d: Deps,
  args: { mes?: string; tipo?: "entrada" | "saida"; status?: "pago" | "agendado"; limit?: number },
): Promise<{ lancamentos: Record<string, any>[] }> {
  let faixa: { de: string; ate: string } | null = null;
  if (args.mes) {
    const [ano, mes] = args.mes.split("-").map(Number);
    if (mes < 1 || mes > 12) throw new McpInputError("Mês inválido. Use o formato YYYY-MM.");
    faixa = {
      de: `${ano}-${pad(mes)}-01`,
      ate: mes === 12 ? `${ano + 1}-01-01` : `${ano}-${pad(mes + 1)}-01`,
    };
  }
  let q = (d.db as any)
    .from("transacoes")
    .select(LANCAMENTO_FIELDS.join(","))
    .eq("conta_id", d.ctx.conta_id);
  if (faixa) q = q.gte("data", faixa.de).lt("data", faixa.ate);
  if (args.tipo) q = q.eq("tipo", args.tipo);
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q.order("data", { ascending: false }).limit(args.limit ?? 100);
  if (error) fail(error);
  return { lancamentos: ((data ?? []) as any[]).map((r) => pick(r, LANCAMENTO_FIELDS)) };
}

const RECORRENTE_FIELDS = ["id", "tipo", "descricao", "categoria", "valor", "dia", "inicio", "fim"] as const;

export async function listRecorrentes(
  d: Deps,
  args: { incluir_encerrados?: boolean },
): Promise<{ recorrentes: Record<string, any>[] }> {
  const { data, error } = await (d.db as any)
    .from("transacoes_recorrentes")
    .select(RECORRENTE_FIELDS.join(","))
    .eq("conta_id", d.ctx.conta_id)
    .order("inicio", { ascending: true })
    .order("id", { ascending: true });
  if (error) fail(error);
  const { primeiro } = mesSaoPaulo(nowIso(d));
  const rows = ((data ?? []) as any[]).filter(
    (r) => args.incluir_encerrados || r.fim == null || String(r.fim) >= primeiro,
  );
  return { recorrentes: rows.map((r) => pick(r, RECORRENTE_FIELDS)) };
}

// ---- cobrança ----------------------------------------------------------------------------------

const COBRANCA_CLIENTE_FIELDS = ["id", "nome", "status", "valor_mensal", "data_pagamento"] as const;
const COBRANCA_MEMBRO_FIELDS = ["id", "nome", "custo_mensal", "data_pagamento"] as const;

export async function getCobrancas(d: Deps): Promise<{ clientes: Record<string, any>[]; membros: Record<string, any>[] }> {
  const [clientes, membros] = await Promise.all([
    (d.db as any).from("clientes").select(COBRANCA_CLIENTE_FIELDS.join(",")).eq("conta_id", d.ctx.conta_id).order("nome"),
    (d.db as any).from("membros").select(COBRANCA_MEMBRO_FIELDS.join(",")).eq("conta_id", d.ctx.conta_id).order("nome"),
  ]);
  if (clientes.error) fail(clientes.error);
  if (membros.error) fail(membros.error);
  return {
    clientes: ((clientes.data ?? []) as any[]).map((r) => pick(r, COBRANCA_CLIENTE_FIELDS)),
    membros: ((membros.data ?? []) as any[]).map((r) => pick(r, COBRANCA_MEMBRO_FIELDS)),
  };
}

// ---- Financeiro v2 -----------------------------------------------------------------------------

export async function getFinanceiroV2(d: Deps) {
  const [config, funcoes] = await Promise.all([
    (d.db as any)
      .from("financeiro_config")
      .select("periodo_dia,meta_margem,seeded_at")
      .eq("conta_id", d.ctx.conta_id)
      .maybeSingle(),
    (d.db as any)
      .from("financeiro_funcoes")
      .select("id,nome,ordem")
      .eq("conta_id", d.ctx.conta_id)
      .order("ordem", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (config.error) fail(config.error);
  if (funcoes.error) fail(funcoes.error);
  const periodos = await rpcAs(d, "financeiro_periodos_listar_as");
  const editaveis = await rpcAs(d, "financeiro_periodos_editaveis_as");
  const c = config.data as any;
  return {
    config: {
      periodo_dia: c?.periodo_dia ?? null,
      meta_margem: c?.meta_margem ?? null,
      seeded: c?.seeded_at != null,
    },
    funcoes: ((funcoes.data ?? []) as any[]).map((r) => pick(r, ["id", "nome", "ordem"])),
    periodos: periodos ?? [],
    editaveis: editaveis ?? [],
  };
}

export async function getRentabilidade(d: Deps, args: { inicio?: string }): Promise<unknown> {
  return await rpcAs(d, "financeiro_rentabilidade_as", { p_inicio: args.inicio ?? null });
}

const CLIENTE_VERSAO_FIELDS = ["vale_desde", "valor_mensal", "dia_pagamento", "status", "created_at"] as const;
const ACORDO_VERSAO_FIELDS = [
  "vale_desde", "funcao_id", "modelo", "valor", "unidade", "meta_quantidade", "meta_periodo", "limite_clientes",
  "dia_pagamento", "vigencia_inicio", "vigencia_fim", "created_at",
] as const;

async function exigirDoWorkspace(
  d: Deps,
  table: "clientes" | "membros" | "transacoes_recorrentes",
  id: number,
): Promise<void> {
  const { data, error } = await (d.db as any)
    .from(table)
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
}

export async function getClienteVersoes(d: Deps, args: { cliente_id: number }) {
  await exigirDoWorkspace(d, "clientes", args.cliente_id);
  const { data, error } = await (d.db as any)
    .from("financeiro_cliente_versoes")
    .select(CLIENTE_VERSAO_FIELDS.join(","))
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", args.cliente_id)
    .order("vale_desde", { ascending: false })
    .limit(50);
  if (error) fail(error);
  return { versoes: ((data ?? []) as any[]).map((r) => pick(r, CLIENTE_VERSAO_FIELDS)) };
}

export async function getAcordoVersoes(d: Deps, args: { membro_id: number }) {
  await exigirDoWorkspace(d, "membros", args.membro_id);
  const { data, error } = await (d.db as any)
    .from("financeiro_acordo_versoes")
    .select([...ACORDO_VERSAO_FIELDS, "arquivo_path"].join(","))
    .eq("conta_id", d.ctx.conta_id)
    .eq("membro_id", args.membro_id)
    .order("vale_desde", { ascending: false })
    .limit(50);
  if (error) fail(error);
  return {
    versoes: ((data ?? []) as any[]).map((r) => ({
      ...pick(r, ACORDO_VERSAO_FIELDS),
      tem_contrato: r.arquivo_path != null,
    })),
  };
}

// ---- escritas: lançamentos ---------------------------------------------------------------------

/** Aceita só campos da lista, ignorando `undefined` (campo omitido = não mexer). */
function patchOf(args: Record<string, any>, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) if (args[f] !== undefined) out[f] = args[f];
  return out;
}

function exigirMudanca(patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) throw new McpInputError("Informe ao menos um campo para alterar.");
}

/** `YYYY-MM-DD` que existe no calendário (o regex do zod aceita 2026-02-30). */
function exigirData(s: string): void {
  const [y, m, dd] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== dd) {
    throw new McpInputError("Data inválida. Use uma data real no formato YYYY-MM-DD.");
  }
}

const LANCAMENTO_EDITAVEIS = ["tipo", "descricao", "valor", "data", "categoria", "status", "detalhe", "cliente_id"] as const;

export async function createLancamento(d: Deps, a: Record<string, any>): Promise<Record<string, any>> {
  exigirData(a.data);
  if (a.cliente_id != null) await exigirDoWorkspace(d, "clientes", a.cliente_id);
  const { data, error } = await (d.db as any)
    .from("transacoes")
    .insert({
      conta_id: d.ctx.conta_id,
      user_id: d.ctx.created_by,
      tipo: a.tipo,
      descricao: a.descricao,
      valor: a.valor,
      data: a.data,
      categoria: a.categoria,
      status: a.status ?? "pago",
      detalhe: a.detalhe ?? null,
      cliente_id: a.cliente_id ?? null,
      referencia_agendamento: null,
    })
    .select(LANCAMENTO_FIELDS.join(","))
    .single();
  if (error) fail(error);
  return pick(data as any, LANCAMENTO_FIELDS);
}

export async function updateLancamento(d: Deps, a: Record<string, any>): Promise<Record<string, any>> {
  const patch = patchOf(a, LANCAMENTO_EDITAVEIS);
  exigirMudanca(patch);
  if (patch.data !== undefined) exigirData(patch.data);
  if (patch.cliente_id != null) await exigirDoWorkspace(d, "clientes", patch.cliente_id);
  const { data, error } = await (d.db as any)
    .from("transacoes")
    .update(patch)
    .eq("id", a.lancamento_id)
    .eq("conta_id", d.ctx.conta_id)
    .select(LANCAMENTO_FIELDS.join(","))
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  return pick(data as any, LANCAMENTO_FIELDS);
}

export async function deleteLancamento(d: Deps, a: { lancamento_id: number }): Promise<{ ok: true }> {
  const { data, error } = await (d.db as any)
    .from("transacoes")
    .delete()
    .eq("id", a.lancamento_id)
    .eq("conta_id", d.ctx.conta_id)
    .select("id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw notFound();
  return { ok: true };
}

const ORIGEM_TABELA = { cliente: "clientes", membro: "membros", recorrente: "transacoes_recorrentes" } as const;

export async function confirmarAgendamento(d: Deps, a: { origem: string; id: number }): Promise<unknown> {
  if (!Object.hasOwn(ORIGEM_TABELA, a.origem)) throw new McpInputError(FINANCEIRO_ERROS.origem_invalida);
  // O núcleo SQL também filtra por conta_id; conferir aqui recusa o id alheio antes de qualquer escrita.
  await exigirDoWorkspace(d, ORIGEM_TABELA[a.origem as keyof typeof ORIGEM_TABELA], a.id);
  return await rpcAs(d, "financeiro_agendamento_confirmar_as", { p_origem: a.origem, p_id: a.id });
}

// ---- escritas: recorrentes ---------------------------------------------------------------------

export async function createRecorrente(d: Deps, a: Record<string, any>): Promise<unknown> {
  const inicioMes: string = a.inicio_mes ?? mesSaoPaulo(nowIso(d)).primeiro.slice(0, 7);
  const [, mes] = inicioMes.split("-").map(Number);
  if (!/^\d{4}-\d{2}$/.test(inicioMes) || mes < 1 || mes > 12) {
    throw new McpInputError("Mês inválido. Use o formato YYYY-MM.");
  }
  const registrar = a.registrar_primeiro_pago === true;
  let dataPrimeiro: string | null = null;
  if (registrar) {
    if (!a.data_primeiro) {
      throw new McpInputError("Informe data_primeiro (YYYY-MM-DD) para registrar o primeiro pagamento.");
    }
    exigirData(a.data_primeiro);
    if (!String(a.data_primeiro).startsWith(`${inicioMes}-`)) {
      throw new McpInputError("data_primeiro precisa cair dentro de inicio_mes.");
    }
    dataPrimeiro = a.data_primeiro;
  }
  return await rpcAs(d, "financeiro_recorrente_criar_as", {
    p_tipo: a.tipo,
    p_descricao: a.descricao,
    p_categoria: a.categoria,
    p_valor: a.valor,
    p_dia: a.dia,
    p_inicio: `${inicioMes}-01`,
    p_registrar_primeiro_pago: registrar,
    p_data_primeiro: dataPrimeiro,
  });
}

export async function updateRecorrente(d: Deps, a: Record<string, any>): Promise<Record<string, any>> {
  const patch = patchOf(a, ["descricao", "valor", "dia", "categoria"]);
  exigirMudanca(patch);
  const { data, error } = await (d.db as any)
    .from("transacoes_recorrentes")
    .update(patch)
    .eq("id", a.recorrente_id)
    .eq("conta_id", d.ctx.conta_id)
    .select(RECORRENTE_FIELDS.join(","))
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  return pick(data as any, RECORRENTE_FIELDS);
}

/** Mesma regra do CRM: começou neste mês (ou depois) → apaga; senão fim = primeiro dia do mês anterior. */
export async function encerrarRecorrente(
  d: Deps,
  a: { recorrente_id: number },
): Promise<{ acao: "removido" | "encerrado"; fim?: string }> {
  const { data: row, error } = await (d.db as any)
    .from("transacoes_recorrentes")
    .select("id,inicio,fim")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", a.recorrente_id)
    .maybeSingle();
  if (error) fail(error);
  if (!row) throw notFound();
  const { anterior } = mesSaoPaulo(nowIso(d));
  if (String(row.inicio) > anterior) {
    const { data, error: e } = await (d.db as any)
      .from("transacoes_recorrentes")
      .delete()
      .eq("id", a.recorrente_id)
      .eq("conta_id", d.ctx.conta_id)
      .select("id");
    if (e) fail(e);
    if (!Array.isArray(data) || data.length === 0) throw notFound();
    return { acao: "removido" };
  }
  // Já encerrado antes do mês anterior: empurrar o fim para frente reabriria meses.
  if (row.fim != null && String(row.fim) <= anterior) return { acao: "encerrado", fim: String(row.fim) };
  const { data, error: e } = await (d.db as any)
    .from("transacoes_recorrentes")
    .update({ fim: anterior })
    .eq("id", a.recorrente_id)
    .eq("conta_id", d.ctx.conta_id)
    .select("id");
  if (e) fail(e);
  if (!Array.isArray(data) || data.length === 0) throw notFound();
  return { acao: "encerrado", fim: anterior };
}

// ---- escritas: cobrança ------------------------------------------------------------------------

const STATUS_COBRANCA = ["ativo", "pausado", "encerrado"] as const;
const COBRANCA_CLIENTE_SAIDA = ["id", "status", "valor_mensal", "data_pagamento"] as const;

async function financeiroV2Ativo(d: Deps): Promise<boolean> {
  return await effectivePlanFeature(d.db as any, d.ctx.conta_id, "feature_financeiro_v2");
}

async function valeDesdePadrao(d: Deps): Promise<string> {
  const { data, error } = await (d.db as any)
    .from("financeiro_periodos")
    .select("inicio")
    .eq("conta_id", d.ctx.conta_id)
    .eq("status", "aberto")
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error);
  if (data?.inicio) return String(data.inicio);
  // Seed feito e o job ainda não abriu período: o primeiro editável.
  const editaveis = (await rpcAs(d, "financeiro_periodos_editaveis_as")) as any[] | null;
  const primeiro = editaveis?.[0]?.inicio;
  if (!primeiro) throw new McpInputError(FINANCEIRO_ERROS.periodo_invalido);
  return String(primeiro);
}

export async function setCobrancaCliente(d: Deps, a: Record<string, any>): Promise<Record<string, any>> {
  const patch = patchOf(a, ["valor_mensal", "dia_pagamento", "status"]);
  exigirMudanca(patch);
  if (a.vale_desde !== undefined) exigirData(a.vale_desde);

  const { data: cliente, error } = await (d.db as any)
    .from("clientes")
    .select("id,valor_mensal,data_pagamento,status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", a.cliente_id)
    .maybeSingle();
  if (error) fail(error);
  if (!cliente) throw notFound();

  const { data: config, error: cfgErr } = await (d.db as any)
    .from("financeiro_config")
    .select("seeded_at")
    .eq("conta_id", d.ctx.conta_id)
    .maybeSingle();
  if (cfgErr) fail(cfgErr);
  const v2 = config?.seeded_at != null && (await financeiroV2Ativo(d));

  if (!v2) {
    // Sem seed, ou seed com a flag desligada: as `_as` do v2 recusariam (flag primeiro), então
    // vai para as colunas legadas e o trigger gera a versão (created_by NULL, sem auth.uid()).
    if (a.vale_desde !== undefined) {
      throw new McpInputError(
        "vale_desde só vale com o Financeiro v2 ligado e configurado. Omita o campo para gravar a cobrança atual.",
      );
    }
    const legacy: Record<string, any> = {};
    if (a.valor_mensal !== undefined) legacy.valor_mensal = a.valor_mensal;
    if (a.dia_pagamento !== undefined) legacy.data_pagamento = a.dia_pagamento;
    if (a.status !== undefined) legacy.status = a.status;
    exigirMudanca(legacy);
    const { data, error: e } = await (d.db as any)
      .from("clientes")
      .update(legacy)
      .eq("id", a.cliente_id)
      .eq("conta_id", d.ctx.conta_id)
      .select(COBRANCA_CLIENTE_SAIDA.join(","))
      .maybeSingle();
    if (e) fail(e);
    if (!data) throw notFound();
    return pick(data as any, COBRANCA_CLIENTE_SAIDA);
  }

  const valeDesde: string = a.vale_desde ?? (await valeDesdePadrao(d));
  const { data: atual, error: vErr } = await (d.db as any)
    .from("financeiro_cliente_versoes")
    .select("vale_desde,valor_mensal,dia_pagamento,status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", a.cliente_id)
    .lte("vale_desde", valeDesde)
    .order("vale_desde", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr) fail(vErr);

  // `p_status` não aceita NULL: o que o agente omitiu vem da versão vigente (ou, sem versão, das colunas legadas).
  const legadoStatus = (STATUS_COBRANCA as readonly string[]).includes(cliente.status) ? cliente.status : "ativo";
  const valor = a.valor_mensal ?? atual?.valor_mensal ?? cliente.valor_mensal ?? 0;
  const dia = a.dia_pagamento !== undefined
    ? a.dia_pagamento
    : atual
    ? atual.dia_pagamento ?? null
    : cliente.data_pagamento ?? null;
  const status = a.status ?? atual?.status ?? legadoStatus;
  await rpcAs(d, "financeiro_cliente_salvar_as", {
    p_cliente_id: a.cliente_id,
    p_vale_desde: valeDesde,
    p_valor_mensal: valor,
    p_dia_pagamento: dia,
    p_status: status,
  });
  return { ok: true, cliente_id: a.cliente_id, vale_desde: valeDesde, valor_mensal: valor, dia_pagamento: dia, status };
}

const CUSTO_MEMBRO_SAIDA = ["id", "custo_mensal", "data_pagamento"] as const;

export async function setCustoMembro(d: Deps, a: Record<string, any>): Promise<Record<string, any>> {
  const legacy: Record<string, any> = {};
  if (a.custo_mensal !== undefined) legacy.custo_mensal = a.custo_mensal;
  if (a.dia_pagamento !== undefined) legacy.data_pagamento = a.dia_pagamento;
  exigirMudanca(legacy);
  if (await financeiroV2Ativo(d)) {
    throw new McpInputError("Com o Financeiro v2 ligado, o custo vem do acordo. Use save_acordo.");
  }
  await exigirDoWorkspace(d, "membros", a.membro_id);
  const { data, error } = await (d.db as any)
    .from("membros")
    .update(legacy)
    .eq("id", a.membro_id)
    .eq("conta_id", d.ctx.conta_id)
    .select(CUSTO_MEMBRO_SAIDA.join(","))
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw notFound();
  return pick(data as any, CUSTO_MEMBRO_SAIDA);
}
