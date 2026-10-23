// deno-lint-ignore-file no-explicit-any
// Ferramentas MCP do Financeiro. Todas `ownerOnly` (somente o dono do workspace) e com
// `auditArgs` explícito: só ids e filtros, nunca valores, nomes ou descrições.
import { z } from "npm:zod@3";
import { register } from "./register.ts";
import type { Deps } from "./queries.ts";
import { CATEGORIAS_FINANCEIRO } from "./financeiro-errors.ts";
import {
  confirmarAgendamento,
  createLancamento,
  createRecorrente,
  deleteLancamento,
  encerrarRecorrente,
  getAcordoVersoes,
  getClienteVersoes,
  getCobrancas,
  getFinanceiroV2,
  getRentabilidade,
  listLancamentos,
  listRecorrentes,
  setCobrancaCliente,
  setCustoMembro,
  updateLancamento,
  updateRecorrente,
} from "./financeiro.ts";

export const DATE_ONLY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD");
export const MES = z.string().regex(/^\d{4}-\d{2}$/, "Use o formato YYYY-MM");

export function registerFinanceiroTools(server: any, deps: Deps): void {
  const own = { ownerOnly: true } as const;
  const v2 = { ownerOnly: true, feature: "feature_financeiro_v2" } as const;

  register(server, deps, "list_lancamentos", "financeiro:read",
    "Lista os lançamentos (linhas de transacoes) do Financeiro, mais recentes primeiro. Filtros: mes (YYYY-MM), tipo, status, limit (padrão 100, máx. 500). Somente para o dono do workspace. Os agendados projetados do mês NÃO estão incluídos: eles são derivados da cobrança cadastrada (get_cobrancas) e dos modelos recorrentes (list_recorrentes); só aparecem aqui como linhas depois de confirmados ou quando foram criados como status 'agendado'.",
    {
      mes: MES.optional(),
      tipo: z.enum(["entrada", "saida"]).optional(),
      status: z.enum(["pago", "agendado"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    (a) => listLancamentos(deps, a),
    (a, r) => ({ mes: a.mes, tipo: a.tipo, status: a.status, limit: a.limit, count: r?.lancamentos?.length ?? 0 }),
    own);

  register(server, deps, "list_recorrentes", "financeiro:read",
    "Lista os modelos de lançamentos recorrentes do Financeiro (ativos por padrão: sem fim ou com fim a partir do mês corrente). Use incluir_encerrados para ver também os encerrados. Somente para o dono do workspace.",
    { incluir_encerrados: z.boolean().default(false) },
    (a) => listRecorrentes(deps, a),
    (a, r) => ({ incluir_encerrados: a.incluir_encerrados, count: r?.recorrentes?.length ?? 0 }),
    own);

  register(server, deps, "get_cobrancas", "financeiro:read",
    "Devolve a cobrança cadastrada: clientes (id, nome, status, valor_mensal, data_pagamento) e membros (id, nome, custo_mensal, data_pagamento). É a base dos agendados do mês corrente, junto com list_recorrentes. Somente para o dono do workspace.",
    {},
    () => getCobrancas(deps),
    (_a, r) => ({ clientes: r?.clientes?.length ?? 0, membros: r?.membros?.length ?? 0 }),
    own);

  register(server, deps, "get_financeiro_v2", "financeiro:read",
    "Financeiro v2 (rentabilidade): configuração (periodo_dia, meta_margem, seeded; nulos antes de configurar), funções da equipe, períodos e os períodos editáveis. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    {},
    () => getFinanceiroV2(deps),
    (_a, r) => ({ funcoes: r?.funcoes?.length ?? 0, periodos: r?.periodos?.length ?? 0 }),
    v2);

  register(server, deps, "get_rentabilidade", "financeiro:read",
    "Rentabilidade de um período do Financeiro v2. Sem inicio devolve o período vigente; com inicio (YYYY-MM-DD, um dos editáveis ou períodos fechados) devolve aquele. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { inicio: DATE_ONLY.optional() },
    (a) => getRentabilidade(deps, a),
    (a) => ({ inicio: a.inicio }),
    v2);

  register(server, deps, "get_cliente_versoes", "financeiro:read",
    "Versões de cobrança de um cliente no Financeiro v2 (vale_desde, valor_mensal, dia_pagamento, status), mais recentes primeiro, até 50. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { cliente_id: z.number().int() },
    (a) => getClienteVersoes(deps, a),
    (a, r) => ({ cliente_id: a.cliente_id, count: r?.versoes?.length ?? 0 }),
    v2);

  register(server, deps, "get_acordo_versoes", "financeiro:read",
    "Versões do acordo de um membro no Financeiro v2 (vale_desde, função, modelo, valores, meta, limite, vigência e tem_contrato; o arquivo do contrato não sai), mais recentes primeiro, até 50. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { membro_id: z.number().int() },
    (a) => getAcordoVersoes(deps, a),
    (a, r) => ({ membro_id: a.membro_id, count: r?.versoes?.length ?? 0 }),
    v2);

  // ---- escrita (financeiro:write) ------------------------------------------------------------
  // auditArgs: só ids, mês/vale_desde e contagens. Nunca valor, descrição, detalhe ou nome.
  const TIPO = z.enum(["entrada", "saida"]);
  const CATEGORIA = z.enum(CATEGORIAS_FINANCEIRO);
  const DIA = z.number().int().min(1).max(31);
  const ID = z.number().int();

  register(server, deps, "create_lancamento", "financeiro:write",
    "Cria um lançamento (linha de transacoes) no Financeiro. valor em reais (> 0), data YYYY-MM-DD, categoria da lista do CRM, status 'pago' (padrão) ou 'agendado'. cliente_id opcional (precisa ser do workspace). Para confirmar um agendado projetado use confirmar_agendamento (não crie à mão, senão duplica). Somente para o dono do workspace.",
    {
      tipo: TIPO,
      descricao: z.string().min(1).max(200),
      valor: z.number().positive(),
      data: DATE_ONLY,
      categoria: CATEGORIA,
      status: z.enum(["pago", "agendado"]).default("pago"),
      detalhe: z.string().max(200).optional(),
      cliente_id: ID.optional(),
    },
    (a) => createLancamento(deps, a),
    (_a, r) => ({ lancamento_id: r?.id }),
    own);

  register(server, deps, "update_lancamento", "financeiro:write",
    "Altera campos de um lançamento por lancamento_id (informe ao menos um: tipo, descricao, valor, data, categoria, status, detalhe, cliente_id; detalhe e cliente_id aceitam null para limpar). Não muda a referência de agendamento. Somente para o dono do workspace.",
    {
      lancamento_id: ID,
      tipo: TIPO.optional(),
      descricao: z.string().min(1).max(200).optional(),
      valor: z.number().positive().optional(),
      data: DATE_ONLY.optional(),
      categoria: CATEGORIA.optional(),
      status: z.enum(["pago", "agendado"]).optional(),
      detalhe: z.string().max(200).nullable().optional(),
      cliente_id: ID.nullable().optional(),
    },
    (a) => updateLancamento(deps, a),
    (a) => ({ lancamento_id: a.lancamento_id }),
    own);

  register(server, deps, "delete_lancamento", "financeiro:write",
    "Remove um lançamento por lancamento_id. Irreversível. Somente para o dono do workspace.",
    { lancamento_id: ID },
    (a) => deleteLancamento(deps, a),
    (a) => ({ lancamento_id: a.lancamento_id }),
    own);

  register(server, deps, "confirmar_agendamento", "financeiro:write",
    "Confirma como pago o agendado do MÊS CORRENTE (America/Sao_Paulo) de uma origem: 'cliente' (ativo e com dia de pagamento), 'membro' (com dia de pagamento) ou 'recorrente' (ativo no mês); id é o do cliente, membro ou modelo recorrente. Recusa se já foi confirmado neste mês ou se o valor não está definido. Somente para o dono do workspace.",
    { origem: z.enum(["cliente", "membro", "recorrente"]), id: ID },
    (a) => confirmarAgendamento(deps, a),
    (a) => ({ origem: a.origem, [`${a.origem}_id`]: a.id }),
    own);

  register(server, deps, "create_recorrente", "financeiro:write",
    "Cria um modelo de lançamento recorrente (aparece todo mês como agendado a confirmar). dia 1..31 (meses curtos usam o último dia), inicio_mes YYYY-MM (padrão: mês corrente). Com registrar_primeiro_pago, grava também a primeira ocorrência paga: exige data_primeiro dentro de inicio_mes (sem registrar_primeiro_pago, data_primeiro é recusado). Devolve { recorrente, lancamento|null }. Não é idempotente: liste com list_recorrentes antes de recriar. Somente para o dono do workspace.",
    {
      tipo: TIPO,
      descricao: z.string().min(1).max(200),
      valor: z.number().positive(),
      dia: DIA,
      categoria: CATEGORIA,
      inicio_mes: MES.optional(),
      registrar_primeiro_pago: z.boolean().default(false),
      data_primeiro: DATE_ONLY.optional(),
    },
    (a) => createRecorrente(deps, a),
    (a, r) => ({
      recorrente_id: r?.recorrente?.id,
      inicio_mes: typeof r?.recorrente?.inicio === "string" ? r.recorrente.inicio.slice(0, 7) : undefined,
      registrar_primeiro_pago: a.registrar_primeiro_pago === true,
    }),
    own);

  register(server, deps, "update_recorrente", "financeiro:write",
    "Altera um modelo recorrente por recorrente_id (informe ao menos um: descricao, valor, dia, categoria). Somente para o dono do workspace.",
    {
      recorrente_id: ID,
      descricao: z.string().min(1).max(200).optional(),
      valor: z.number().positive().optional(),
      dia: DIA.optional(),
      categoria: CATEGORIA.optional(),
    },
    (a) => updateRecorrente(deps, a),
    (a) => ({ recorrente_id: a.recorrente_id }),
    own);

  register(server, deps, "encerrar_recorrente", "financeiro:write",
    "Encerra um modelo recorrente: se começou neste mês (ou depois) ele é removido (acao 'removido'); senão recebe fim = primeiro dia do mês anterior (acao 'encerrado', com fim). Mês em America/Sao_Paulo. Somente para o dono do workspace.",
    { recorrente_id: ID },
    (a) => encerrarRecorrente(deps, a),
    (a, r) => ({ recorrente_id: a.recorrente_id, acao: r?.acao }),
    own);

  register(server, deps, "set_cobranca_cliente", "financeiro:write",
    "Define a cobrança de um cliente: valor_mensal (>= 0), dia_pagamento (1..31 ou null para limpar) e/ou status ('ativo'|'pausado'|'encerrado'); campos omitidos ficam como estão. Com o Financeiro v2 configurado vira uma nova versão que vale desde vale_desde (YYYY-MM-DD; padrão: início do período aberto) e respeita períodos fechados. Sem o v2, grava direto no cliente e vale_desde é recusado. Somente para o dono do workspace.",
    {
      cliente_id: ID,
      valor_mensal: z.number().min(0).optional(),
      dia_pagamento: DIA.nullable().optional(),
      status: z.enum(["ativo", "pausado", "encerrado"]).optional(),
      vale_desde: DATE_ONLY.optional(),
    },
    (a) => setCobrancaCliente(deps, a),
    (a, r) => ({ cliente_id: a.cliente_id, vale_desde: a.vale_desde ?? r?.vale_desde }),
    own);

  register(server, deps, "set_custo_membro", "financeiro:write",
    "Define o custo mensal (>= 0) e/ou o dia de pagamento (1..31 ou null) de um membro, direto no cadastro. Só sem o Financeiro v2: com ele ligado o custo vem do acordo e a ferramenta recusa (use save_acordo). Somente para o dono do workspace.",
    {
      membro_id: ID,
      custo_mensal: z.number().min(0).optional(),
      dia_pagamento: DIA.nullable().optional(),
    },
    (a) => setCustoMembro(deps, a),
    (a) => ({ membro_id: a.membro_id }),
    own);
}
