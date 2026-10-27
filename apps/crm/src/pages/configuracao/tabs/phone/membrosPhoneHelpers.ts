import { i18n } from '@mesaas/i18n';

/** Member role as the desktop RoleBadge words it (custom papel name wins). */
export function memberRoleLabel(member: Record<string, string>): string {
  if (member.papel_nome) return member.papel_nome;
  const role = member.role;
  if (role === 'owner' || role === 'admin' || role === 'agent') {
    return i18n.t(`settings:invite.roles.${role}`);
  }
  return role;
}

/** Invite role, lower case, as the desktop invite row words it. */
export function inviteRoleLabel(role: string): string {
  if (role === 'owner' || role === 'admin' || role === 'agent') {
    return i18n.t(`settings:invite.rolesLower.${role}`);
  }
  return role;
}

/** Same text as the desktop `InviteTimeLeft` ("6d 4h restantes"), or null when it shows nothing. */
export function inviteTimeLeftLabel(
  expiresAt: string | null | undefined,
  status: string,
  now = Date.now(),
): string | null {
  if (status !== 'pending' || !expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return days > 0
    ? i18n.t('settings:invite.timeLeftDays', { days, hours })
    : i18n.t('settings:invite.timeLeftHours', { hours });
}

/** Role select encoding used by the desktop dialogs: 'admin' | 'agent' | 'custom:<uuid>'. */
export function memberRoleValue(member: Record<string, string>): string {
  return member.role_id ? `custom:${member.role_id}` : member.role;
}
