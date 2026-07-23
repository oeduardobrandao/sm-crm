import type { InviteInfo, InviteAuthState } from '../lib/api';

/**
 * One plain-language chip per invited email, first match wins (escalating).
 * "email sent, never opened" requires a recorded confirmation_sent_at so a
 * pre-existing / imported auth user is not mislabeled (spec finding 4).
 */
export function authStateLabel(auth: InviteAuthState | null): string {
  if (!auth) return 'no account';
  if (auth.is_member) return 'member of this workspace';
  if (auth.has_password === true && auth.onboarding_complete) return 'onboarded';
  if (auth.email_confirmed && auth.has_password === false) return 'confirmed, no password';
  if (auth.confirmation_sent_at) return 'email sent, never opened';
  return 'account exists (no send recorded)';
}

export function statusTags(invite: InviteInfo): string[] {
  const tags: string[] = [];
  if (invite.silent_add) tags.push('added silently — no email was sent');
  if (invite.link_expired) tags.push('link expired');
  return tags;
}

export function canActOnInvite(invite: InviteInfo): boolean {
  return invite.status === 'pending' || invite.status === 'expired';
}
