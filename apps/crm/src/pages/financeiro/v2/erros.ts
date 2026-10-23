import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// Copy for the errors the Financeiro v2 RPCs raise on purpose. Postgres puts the RAISE
// text in `message` (PostgREST relays it as-is), so the match is on the token inside it,
// the same way lib/entitlement-errors.ts reads `plan_limit_exceeded:...`.
const COPY: ReadonlyArray<readonly [token: string, copy: string]> = [
  ['periodo_fechado', 'Este período está fechado. Escolha outro em Vale a partir de.'],
  ['cliente_encerrado', 'Este cliente está encerrado neste período.'],
  ['sem_atribuicao', 'Atribua a pessoa ao cliente antes de informar entregas.'],
  ['nao_configurado', 'O financeiro ainda não foi montado.'],
  ['periodo_invalido', 'Esse período não existe mais. Escolha outro.'],
  ['not_found', 'Não encontramos esse registro. Atualize a página.'],
  ['financial_access_denied', 'Você não tem permissão para alterar o financeiro.'],
];

function leitura(e: unknown): { message: string; code: string } {
  if (!e || typeof e !== 'object') return { message: '', code: '' };
  const { message, code } = e as { message?: unknown; code?: unknown };
  return {
    message: typeof message === 'string' ? message : '',
    code: typeof code === 'string' ? code : '',
  };
}

/** pt-BR copy for a Financeiro v2 RPC error, or null so the caller keeps its generic copy. */
export function mensagemErroFinanceiro(e: unknown): string | null {
  const { message, code } = leitura(e);
  for (const [token, copy] of COPY) {
    if (message.includes(token)) return copy;
  }
  // P0002 is no_data_found: the RPCs raise it for `not_found`.
  if (code === 'P0002') return COPY.find(([t]) => t === 'not_found')![1];
  return null;
}

/** The workspace has not run the seed (or lost it): the layout must go back to the onboarding. */
export function ehNaoConfigurado(e: unknown): boolean {
  return leitura(e).message.includes('nao_configurado');
}

/**
 * Toast for a failed Financeiro v2 write, after `handleEntitlementMutationError` returned
 * false. Uses the mapped copy when there is one, `fallback` otherwise; on `nao_configurado`
 * it refreshes the v2 queries so the layout re-reads `seeded: false` and shows the onboarding.
 */
export function avisarErroFinanceiro(
  e: unknown,
  fallback: string,
  qc: Pick<QueryClient, 'invalidateQueries'>,
): void {
  toast.error(mensagemErroFinanceiro(e) ?? fallback);
  if (ehNaoConfigurado(e)) void qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
}
