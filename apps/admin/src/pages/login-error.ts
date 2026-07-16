import { AuthError } from '@supabase/supabase-js';

/**
 * Maps a Supabase sign-in failure to a message for the operator.
 *
 * Every failure used to surface as "Email ou senha inválidos.", which sent people hunting for
 * a password problem when the real cause was the network, a rate limit, or an unconfirmed
 * account. Only report bad credentials when that is actually what came back.
 */
export function describeSignInError(error: AuthError): string {
  // No HTTP status means the request never got a reply (offline, DNS, CORS, server down).
  if (error.status === undefined || error.status === 0) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }

  switch (error.code) {
    case 'invalid_credentials':
    case 'invalid_grant':
      return 'Email ou senha inválidos.';
    case 'email_not_confirmed':
      return 'Este email ainda não foi confirmado.';
    case 'user_banned':
      return 'Este usuário está bloqueado.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }

  if (error.status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'Falha na autenticação do aplicativo. Avise o time (chave de API inválida).';
  }
  if (error.status >= 500) {
    return 'O servidor de autenticação falhou. Tente novamente em instantes.';
  }

  return `Não foi possível entrar: ${error.message}`;
}
