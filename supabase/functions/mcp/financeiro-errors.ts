import { McpInputError } from "../_shared/mcp-token.ts";

/**
 * Categorias que o agente pode escrever à mão: exatamente as do formulário do CRM
 * (FinanceiroPage.tsx `CATEGORIAS`). 'Agendamento' fica de fora: só a confirmação de um agendado
 * (RPC) a grava. Nenhuma ferramenta filtra por categoria na leitura.
 */
export const CATEGORIAS_FINANCEIRO = [
  "Mensalidade",
  "Produção",
  "Tráfego",
  "Salário",
  "Imposto",
  "Ferramenta",
  "Outro",
] as const;

/**
 * Todo código que as RPCs do Financeiro levantam (`RAISE EXCEPTION '<código>'`), em português.
 * O teste `errors table covers every RAISE` lê as migrações 20261027* e 20261029* e falha se
 * algum código não estiver aqui. Fora da tabela continua "Internal error.".
 */
export const FINANCEIRO_ERROS: Record<string, string> = {
  "feature_disabled:feature_financial": "O plano deste workspace não inclui o Financeiro.",
  "feature_disabled:feature_financeiro_v2": "O Financeiro v2 não está ativo neste workspace.",
  financial_access_denied: "Sem permissão para acessar o Financeiro deste workspace.",
  owner_only: "Permission denied: somente o dono do workspace pode usar as ferramentas do Financeiro.",
  nao_configurado: "O Financeiro v2 ainda não foi configurado. Use seed_financeiro_v2 primeiro.",
  not_found: "Registro não encontrado neste workspace.",
  periodo_invalido: "Período inválido. Use um início listado em editaveis (get_financeiro_v2).",
  periodo_fechado: "Este período está fechado. Reabra o período antes de alterar.",
  periodo_estado_invalido: "O período não está no estado necessário para esta operação.",
  periodo_dia_invalido: "Dia de início do período inválido. Use um dia de 1 a 28.",
  funcao_duplicada: "Já existe uma função com esse nome.",
  acordo_invalido: "Acordo inválido. Confira modelo, valor, meta e limite de clientes.",
  cliente_encerrado: "O cliente está encerrado e não pode receber atribuição.",
  itens_invalidos: "Itens de entrega inválidos.",
  mudancas_invalidas: "Mudanças de atribuição inválidas.",
  sem_atribuicao: "O membro não está atribuído a esse cliente no período.",
  ja_confirmado: "Já existe um lançamento deste agendamento neste mês. Para alterá-lo, use update_lancamento.",
  origem_invalida: "Origem inválida. Use cliente, membro ou recorrente.",
  nao_agendado: "Não há agendamento deste item no mês corrente.",
  valor_indefinido: "O valor deste agendamento não está definido (nulo ou zero). Cadastre o valor antes de confirmar.",
};

const SQLSTATE_ERROS: Record<string, string> = {
  "23514": "Valor fora do permitido.",
  "23503": "Registro relacionado não encontrado.",
};

/**
 * Converte um erro do PostgREST/supabase-js em `McpInputError` (mensagem em português) quando é
 * um código conhecido do Financeiro; `null` caso contrário (o chamador relança o erro original).
 */
export function mapFinanceiroError(e: unknown): McpInputError | null {
  if (e === null || typeof e !== "object") return null;
  const { message, code } = e as { message?: unknown; code?: unknown };
  if (typeof message === "string" && Object.hasOwn(FINANCEIRO_ERROS, message)) {
    return new McpInputError(FINANCEIRO_ERROS[message]);
  }
  if (typeof code === "string" && Object.hasOwn(SQLSTATE_ERROS, code)) {
    return new McpInputError(SQLSTATE_ERROS[code]);
  }
  return null;
}
