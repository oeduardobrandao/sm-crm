// deno-lint-ignore-file no-explicit-any
// Consultas do Financeiro para o MCP (somente donos). Leituras aqui; escritas entram nas tarefas
// seguintes. Toda consulta direta filtra `conta_id = ctx.conta_id` e devolve uma lista fechada de
// campos (nada de select('*')): o service role ignora RLS, então o filtro é a barreira.
import { McpInputError } from "../_shared/mcp-token.ts";
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

async function exigirDoWorkspace(d: Deps, table: "clientes" | "membros", id: number): Promise<void> {
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
