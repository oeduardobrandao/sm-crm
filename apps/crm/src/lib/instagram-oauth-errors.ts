/**
 * Mapeia o código `ig_error` que o callback do OAuth devolve na URL para a
 * orientação que a interface mostra.
 *
 * Compartilhado entre a página do cliente (CRM, autenticada) e a página pública
 * /conectar/:token. Sem isto as duas divergem em silêncio, e a pessoa que mais
 * precisa da orientação, o cliente final, é justamente quem fica com a cópia pior.
 *
 * Os códigos vêm de supabase/functions/instagram-integration/oauth-error.ts.
 */
export type IgErrorAction =
  | { kind: 'off_meta' }
  | { kind: 'toast'; level: 'info' | 'error'; i18nKey: string };

const KNOWN_ERROR_KEYS: Record<string, string> = {
  no_business_account: 'detail.igNotBusiness',
  missing_permissions: 'detail.igMissingPermissions',
  state_expired: 'detail.igStateExpired',
  account_restricted: 'detail.igRestricted',
  rate_limited: 'detail.igRateLimited',
  link_revoked: 'detail.igLinkRevoked',
};

export function resolveIgError(code: string | null): IgErrorAction | null {
  if (!code) return null;
  if (code === 'off_meta_activity') return { kind: 'off_meta' };
  if (code === 'cancelled') return { kind: 'toast', level: 'info', i18nKey: 'detail.igCancelled' };
  const known = KNOWN_ERROR_KEYS[code];
  return { kind: 'toast', level: 'error', i18nKey: known ?? 'detail.igError' };
}
