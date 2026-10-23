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
  deleteFuncao,
  deleteLancamento,
  encerrarRecorrente,
  fecharPeriodo,
  getAcordoVersoes,
  getClienteVersoes,
  getCobrancas,
  getFinanceiroV2,
  getRentabilidade,
  listLancamentos,
  listRecorrentes,
  reabrirPeriodo,
  saveAcordo,
  saveAtribuicoes,
  saveEntregas,
  saveFinanceiroConfig,
  saveFuncao,
  seedFinanceiroV2,
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

  // ---- escrita do Financeiro v2 (financeiro:write + feature_financeiro_v2) -------------------
  const DIA_PERIODO = z.number().int().min(1).max(28);

  register(server, deps, "seed_financeiro_v2", "financeiro:write",
    "Configura o Financeiro v2 do workspace pela primeira vez: periodo_dia (1..28) é o dia em que cada período começa. Abre o período que contém hoje, cria as funções padrão (se não houver nenhuma) e copia a cobrança atual de clientes e acordos dos membros como primeira versão. Idempotente: se já estava configurado devolve ja_existia true sem mudar nada. Devolve { seeded, ja_existia }. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { periodo_dia: DIA_PERIODO },
    (a) => seedFinanceiroV2(deps, a),
    (a, r) => ({ periodo_dia: a.periodo_dia, ja_existia: r?.ja_existia }),
    v2);

  register(server, deps, "save_financeiro_config", "financeiro:write",
    "Altera a configuração do Financeiro v2: periodo_dia (1..28, dia em que cada período começa) e/ou meta_margem (0..100, em %). Informe ao menos um; o omitido fica como está. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { periodo_dia: DIA_PERIODO.optional(), meta_margem: z.number().min(0).max(100).optional() },
    (a) => saveFinanceiroConfig(deps, a),
    (a) => ({ periodo_dia: a.periodo_dia }),
    v2);

  register(server, deps, "save_funcao", "financeiro:write",
    "Cria (sem funcao_id) ou renomeia/reordena (com funcao_id) uma função da equipe no Financeiro v2. nome 1..60 caracteres e único no workspace; ordem >= 0 (padrão: depois da última). Devolve { funcao_id }. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { funcao_id: ID.optional(), nome: z.string().trim().min(1).max(60), ordem: z.number().int().min(0).optional() },
    (a) => saveFuncao(deps, a),
    (_a, r) => ({ funcao_id: r?.funcao_id }),
    v2);

  register(server, deps, "delete_funcao", "financeiro:write",
    "Remove uma função por funcao_id. Os acordos que a usavam ficam sem função. Irreversível. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { funcao_id: ID },
    (a) => deleteFuncao(deps, a),
    (a) => ({ funcao_id: a.funcao_id }),
    v2);

  register(server, deps, "save_acordo", "financeiro:write",
    "Grava uma nova versão do acordo de um membro no Financeiro v2, válida desde vale_desde (YYYY-MM-DD; padrão: início do período aberto; períodos fechados são recusados). Envie o acordo COMPLETO: o que for omitido vira null (não herda da versão anterior; consulte get_acordo_versoes antes). modelo: 'mensal_meta' | 'mensal_limite' | 'por_entrega'; valor em reais (>= 0); unidade, meta_quantidade e meta_periodo ('dia_util'|'semana'|'mes') descrevem a meta; mensal_meta exige meta_quantidade >= 1 e mensal_limite exige limite_clientes >= 1 (unidade e meta só valem em mensal_meta, limite só em mensal_limite; o resto é descartado); dia_pagamento 1..31; vigencia_inicio/vigencia_fim YYYY-MM-DD. O contrato anexado é mantido. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    {
      membro_id: ID,
      vale_desde: DATE_ONLY.optional(),
      funcao_id: ID.nullable().optional(),
      modelo: z.enum(["mensal_meta", "mensal_limite", "por_entrega"]),
      valor: z.number().min(0),
      unidade: z.string().nullable().optional(),
      meta_quantidade: z.number().int().min(1).nullable().optional(),
      meta_periodo: z.enum(["dia_util", "semana", "mes"]).nullable().optional(),
      limite_clientes: z.number().int().min(1).nullable().optional(),
      dia_pagamento: DIA.nullable().optional(),
      vigencia_inicio: DATE_ONLY.nullable().optional(),
      vigencia_fim: DATE_ONLY.nullable().optional(),
    },
    (a) => saveAcordo(deps, a),
    (a, r) => ({ membro_id: a.membro_id, vale_desde: a.vale_desde ?? r?.vale_desde }),
    v2);

  register(server, deps, "save_atribuicoes", "financeiro:write",
    "Atribui (ativo true) ou remove (ativo false) membros de clientes no Financeiro v2, a partir de vale_desde (YYYY-MM-DD; padrão: início do período aberto). Até 200 mudanças por chamada, tudo ou nada. Recusa cliente encerrado e períodos fechados. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    {
      vale_desde: DATE_ONLY.optional(),
      mudancas: z.array(z.object({ membro_id: ID, cliente_id: ID, ativo: z.boolean() })).min(1).max(200),
    },
    (a) => saveAtribuicoes(deps, a),
    (a, r) => ({ vale_desde: a.vale_desde ?? r?.vale_desde, count: r?.mudancas ?? a.mudancas?.length }),
    v2);

  register(server, deps, "save_entregas", "financeiro:write",
    "Registra as entregas manuais de um membro no período que começa em inicio (YYYY-MM-DD, um dos editáveis de get_financeiro_v2): quantidade >= 0 por cliente, ou null para apagar o registro manual. O membro precisa estar atribuído ao cliente no período. Até 200 itens, tudo ou nada. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    {
      inicio: DATE_ONLY,
      membro_id: ID,
      itens: z.array(z.object({ cliente_id: ID, quantidade: z.number().int().min(0).nullable() })).min(1).max(200),
    },
    (a) => saveEntregas(deps, a),
    (a, r) => ({ inicio: a.inicio, membro_id: a.membro_id, count: r?.itens ?? a.itens?.length }),
    v2);

  register(server, deps, "fechar_periodo", "financeiro:write",
    "Fecha o período que começa em inicio (YYYY-MM-DD), congelando um snapshot da rentabilidade. Só períodos abertos. Reversível com reabrir_periodo. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { inicio: DATE_ONLY },
    (a) => fecharPeriodo(deps, a),
    (a) => ({ inicio: a.inicio }),
    v2);

  register(server, deps, "reabrir_periodo", "financeiro:write",
    "Reabre um período fechado que começa em inicio (YYYY-MM-DD) para voltar a editar cobrança, acordos, atribuições e entregas. Somente para o dono do workspace e com o Financeiro v2 ativo.",
    { inicio: DATE_ONLY },
    (a) => reabrirPeriodo(deps, a),
    (a) => ({ inicio: a.inicio }),
    v2);
}
