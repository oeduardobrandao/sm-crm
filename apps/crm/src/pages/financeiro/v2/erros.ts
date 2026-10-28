import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';

// Copy for the errors the Financeiro v2 RPCs raise on purpose. Postgres puts the RAISE
// text in `message` (PostgREST relays it as-is), so the match is on the token inside it
// (as a whole word), the same way lib/entitlement-errors.ts reads `plan_limit_exceeded:...`.
// The copy lives under `financeV2:erros.<token>` and is resolved when the error is read.
const TOKENS = [
  'periodo_fechado',
  'cliente_encerrado',
  'sem_atribuicao',
  'nao_configurado',
  'periodo_invalido',
  'not_found',
  'financial_access_denied',
  'funcao_duplicada',
] as const;

const copia = (token: (typeof TOKENS)[number]) => i18n.t(`financeV2:erros.${token}`);

/** The token as a whole word: `x_not_found` or `not_found_y` must not read as `not_found`. */
const temToken = (message: string, token: string) => new RegExp(`\\b${token}\\b`).test(message);

function leitura(e: unknown): { message: string; code: string } {
  if (!e || typeof e !== 'object') return { message: '', code: '' };
  const { message, code } = e as { message?: unknown; code?: unknown };
  return {
    message: typeof message === 'string' ? message : '',
    code: typeof code === 'string' ? code : '',
  };
}

/** Copy for a Financeiro v2 RPC error in the UI language, or null so the caller keeps its generic copy. */
export function mensagemErroFinanceiro(e: unknown): string | null {
  const { message, code } = leitura(e);
  for (const token of TOKENS) {
    if (temToken(message, token)) return copia(token);
  }
  // P0002 is no_data_found: the RPCs raise it for `not_found`.
  if (code === 'P0002') return copia('not_found');
  return null;
}

/** The workspace has not run the seed (or lost it): the layout must go back to the onboarding. */
export function ehNaoConfigurado(e: unknown): boolean {
  return temToken(leitura(e).message, 'nao_configurado');
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
