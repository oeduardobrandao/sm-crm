import type { InviteInfo, InviteAuthState } from '../lib/api';

/**
 * One plain-language chip per invited email, first match wins (escalating).
 * "e-mail enviado, nunca aberto" requires a recorded confirmation_sent_at so a
 * pre-existing / imported auth user is not mislabeled (spec finding 4).
 */
export function authStateLabel(auth: InviteAuthState | null): string {
  if (!auth) return 'sem conta';
  if (auth.is_member) return 'membro deste workspace';
  if (auth.has_password === true && auth.onboarding_complete) return 'onboarding concluído';
  if (auth.email_confirmed && auth.has_password === false) return 'confirmado, sem senha';
  if (auth.confirmation_sent_at) return 'e-mail enviado, nunca aberto';
  return 'conta existe (sem envio registrado)';
}

export function statusTags(invite: InviteInfo): string[] {
  const tags: string[] = [];
  if (invite.silent_add) tags.push('adicionado silenciosamente. Nenhum e-mail foi enviado');
  if (invite.link_expired) tags.push('link expirado');
  return tags;
}

export function canActOnInvite(invite: InviteInfo): boolean {
  return invite.status === 'pending' || invite.status === 'expired';
}
