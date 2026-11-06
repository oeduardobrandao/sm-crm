import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';

export function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation('settings');
  const map: Record<string, string> = {
    owner: 'badge-primary',
    admin: 'badge-info',
    agent: 'badge-neutral',
  };
  const label =
    role === 'owner' || role === 'admin' || role === 'agent' ? t(`invite.roles.${role}`) : role;
  return <span className={`badge ${map[role] ?? 'badge-neutral'}`}>{label}</span>;
}

export function InviteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('settings');
  const map: Record<string, string> = {
    pending: 'badge-warning',
    expired: 'badge-danger',
    accepted: 'badge-success',
  };
  const label =
    status === 'pending' || status === 'expired' || status === 'accepted'
      ? t(`invite.status.${status}`)
      : status;
  return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{label}</span>;
}

export function computeEffectiveInviteStatus<
  T extends { status: string; expires_at?: string | null },
>(invites: T[]): T[] {
  return invites.map((inv) => {
    if (inv.status === 'pending' && inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return { ...inv, status: 'expired' as T['status'] };
    }
    return inv;
  });
}

/**
 * invite-user has three success shapes: an invite was mailed, a fresh
 * set-password link was mailed, or an existing user was added to the workspace
 * with no e-mail at all. Reporting all three as "Convite enviado!" hid the third
 * case from owners, who then assumed a mail was in flight.
 */
export function inviteSuccessMessage(result: { message?: string }): string {
  return result.message?.trim() || i18n.t('settings:invite.sent');
}

export function InviteTimeLeft({ expiresAt, status }: { expiresAt: string; status: string }) {
  const { t } = useTranslation('settings');
  if (status !== 'pending' || !expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const label =
    days > 0 ? t('invite.timeLeftDays', { days, hours }) : t('invite.timeLeftHours', { hours });
  return (
    <span
      style={{
        marginLeft: 8,
        color: 'var(--text-light)',
        fontSize: '0.75rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Clock size={12} />
      {label}
    </span>
  );
}
