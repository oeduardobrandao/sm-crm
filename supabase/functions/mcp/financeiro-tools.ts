// deno-lint-ignore-file no-explicit-any
// Ferramentas MCP do Financeiro. Todas `ownerOnly` (somente o dono do workspace) e com
// `auditArgs` explícito: só ids e filtros, nunca valores, nomes ou descrições.
import { z } from "npm:zod@3";
import { register } from "./register.ts";
import type { Deps } from "./queries.ts";
import {
  getAcordoVersoes,
  getClienteVersoes,
  getCobrancas,
  getFinanceiroV2,
  getRentabilidade,
  listLancamentos,
  listRecorrentes,
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
}
