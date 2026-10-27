import { useEffect, type ReactNode } from 'react';
import { Clock, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import type { CheckListOption } from '@/components/mobile/CheckList';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { InviteStatusBadge } from '../../inviteHelpers';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../../phone/ConfigPhoneScreen';
import { useConfigSubScreen } from '../../phone/useConfigSubScreen';
import {
  inviteRoleLabel,
  inviteTimeLeftLabel,
  memberRoleLabel,
  memberRoleValue,
} from './membrosPhoneHelpers';
import './membrosPhone.css';

type Row = Record<string, string>;

export interface MembrosPhoneProps {
  currentUserId?: string;
  loading: boolean;
  members: Row[];
  invites: Row[];
  workspaceRoles: { id: string; nome: string }[];
  /** `equipe:editar`: invite, remove, resend and cancel invites. */
  canManageTeam: boolean;
  /** Chassis owner/admin: change roles, invite as admin or with a custom papel. */
  canAssignRoles: boolean;
  /** Owner only: the per-admin "Ver financeiro" switch. */
  isOwner: boolean;
  /** Not self, and not an owner unless the viewer is the owner (server rule). */
  canActOnMember: (member: Row) => boolean;
  roleSaving: boolean;
  onSaveRole: (userId: string, roleValue: string) => Promise<boolean>;
  financialAccessLoadingId: string | null;
  onToggleFinancialAccess: (memberId: string, checked: boolean) => void;
  removeUserId: string | null;
  onRequestRemove: (memberId: string | null) => void;
  onConfirmRemove: () => void;
  inviteOpen: boolean;
  /** Closing resets the form, as the desktop dialog does. */
  onInviteOpenChange: (open: boolean) => void;
  inviteEmail: string;
  onInviteEmailChange: (email: string) => void;
  inviteRole: string;
  onInviteRoleChange: (role: string) => void;
  inviteLoading: boolean;
  onInvite: () => void;
  cancelInviteId: string | null;
  onRequestCancelInvite: (inviteId: string | null) => void;
  onConfirmCancelInvite: () => void;
  onResendInvite: (invite: Row) => void;
}

function MemberAvatar({ member, large }: { member: Row; large?: boolean }) {
  return (
    <PessoaAvatar
      nome={member.nome || '?'}
      fotoUrl={member.avatar_url}
      seed={member.id}
      className={`phone-config-avatar${large ? ' phone-config-avatar--large' : ''}`}
    />
  );
}

/**
 * Membros on phones (FConfigMembros): the roster and the pending invites as grouped
 * lists. A member opens a pushed screen (role, financial access, remove), the "+"
 * opens the invite sheet, an invite swipes (or long-presses) to Reenviar / Cancelar.
 * State, permissions and handlers all come from MembrosTab.
 */
export function MembrosPhone(props: MembrosPhoneProps) {
  const { t } = useTranslation('settings');
  const { currentUserId, loading, members, invites, canManageTeam, isOwner, canActOnMember } =
    props;
  const sub = useConfigSubScreen<string>();
  const selected = sub.screen ? (members.find((m) => m.id === sub.screen) ?? null) : null;

  // The member left the roster (removed here or elsewhere): back to the list.
  const { screen, close } = sub;
  useEffect(() => {
    if (screen && !loading && !members.some((m) => m.id === screen)) close();
  }, [screen, loading, members, close]);

  const canManageMember = (m: Row) => canManageTeam && canActOnMember(m);
  const showFinancial = (m: Row) => isOwner && m.role === 'admin';
  // A visible e-mail opens the member screen too, even with nothing to edit:
  // the list subtitle stays the role, the full address lives there.
  const isTappable = (m: Row) => canManageMember(m) || showFinancial(m) || Boolean(m.email);

  if (selected) {
    return <MemberScreen {...props} member={selected} onBack={sub.close} />;
  }

  return (
    <ConfigPhoneScreen
      title={t('tabs.membros')}
      trailing={
        canManageTeam ? (
          <PhoneIconButton
            label={t('membros.invite')}
            variant="ink"
            aria-haspopup="dialog"
            onClick={() => props.onInviteOpenChange(true)}
          >
            <Plus aria-hidden="true" />
          </PhoneIconButton>
        ) : undefined
      }
    >
      {loading ? (
        <ConfigPhoneSkeleton groups={1} rows={4} />
      ) : (
        <GroupedList
          header={t('membros.phone.header')}
          footer={
            members.some((m) => canManageMember(m) || showFinancial(m))
              ? t('membros.phone.footerManage')
              : members.some(isTappable)
                ? t('membros.phone.footerEmail')
                : undefined
          }
        >
          {members.map((m) => {
            const self = m.id === currentUserId;
            const role = memberRoleLabel(m);
            const seesFinancial = m.role === 'admin' && Boolean(m.can_see_financials);
            return (
              <Cell
                key={m.id}
                className="phone-membros-cell"
                icon={<MemberAvatar member={m} />}
                label={self ? t('membros.phone.self', { name: m.nome }) : m.nome}
                subtitle={seesFinancial ? t('membros.phone.roleWithFinancial', { role }) : role}
                chevron={isTappable(m)}
                onClick={isTappable(m) ? () => sub.open(m.id) : undefined}
              />
            );
          })}
        </GroupedList>
      )}

      {invites.length > 0 && (
        <GroupedList
          header={t('membros.invites')}
          footer={canManageTeam ? t('membros.phone.invitesFooter') : undefined}
        >
          {invites.map((inv) => (
            <InviteRow key={inv.id} {...props} invite={inv} />
          ))}
        </GroupedList>
      )}

      <InviteSheet {...props} />

      <PhoneConfirmSheet
        open={props.cancelInviteId !== null}
        title={t('membros.cancelInviteTitle')}
        actions={[
          { label: t('actions.yes'), destructive: true, onSelect: props.onConfirmCancelInvite },
        ]}
        cancelLabel={t('actions.no')}
        onCancel={() => props.onRequestCancelInvite(null)}
      />
    </ConfigPhoneScreen>
  );
}

/** One member's pushed screen: role picker, financial access, remove. */
function MemberScreen({
  member,
  onBack,
  workspaceRoles,
  canManageTeam,
  canAssignRoles,
  isOwner,
  canActOnMember,
  roleSaving,
  onSaveRole,
  financialAccessLoadingId,
  onToggleFinancialAccess,
  removeUserId,
  onRequestRemove,
  onConfirmRemove,
}: MembrosPhoneProps & { member: Row; onBack: () => void }) {
  const { t } = useTranslation('settings');
  const canManage = canManageTeam && canActOnMember(member);
  const canEditRole = canManage && canAssignRoles;
  const showFinancial = isOwner && member.role === 'admin';
  const currentRole = memberRoleValue(member);
  // Same options as the desktop "Editar função" dialog.
  const roleOptions: CheckListOption<string>[] = [
    { value: 'admin', label: t('invite.roles.admin') },
    { value: 'agent', label: t('invite.roles.agent') },
    ...workspaceRoles.map((r) => ({ value: `custom:${r.id}`, label: r.nome })),
  ];

  return (
    <ConfigPhoneScreen title={member.nome} subtitle={memberRoleLabel(member)} onBack={onBack}>
      <div className="phone-membros-hero" aria-hidden="true">
        <MemberAvatar member={member} large />
      </div>

      <GroupedList aria-label={t('membros.role')}>
        {canEditRole ? (
          <PickerCell<string>
            label={t('membros.role')}
            options={roleOptions}
            value={currentRole}
            placeholder={memberRoleLabel(member)}
            disabled={roleSaving}
            onChange={(value) => {
              if (value && value !== currentRole) void onSaveRole(member.id, value);
            }}
          />
        ) : (
          <Cell label={t('membros.role')} value={memberRoleLabel(member)} />
        )}
      </GroupedList>

      {member.email && (
        // Header instead of a value cell: the trailing value is capped at half
        // the row, which would cut most addresses.
        <GroupedList header={t('shared.email')}>
          <Cell className="phone-membros-email" label={member.email} />
        </GroupedList>
      )}

      {showFinancial && (
        <GroupedList aria-label={t('membros.phone.financialAccess')}>
          <Cell
            label={t('membros.financialLabel')}
            disabled={financialAccessLoadingId === member.id}
            switch={{
              checked: Boolean(member.can_see_financials),
              onCheckedChange: (checked) => onToggleFinancialAccess(member.id, checked),
            }}
          />
        </GroupedList>
      )}

      {canManage && (
        <GroupedList aria-label={t('shared.remove')}>
          <Cell
            label={t('membros.phone.removeFromWorkspace')}
            destructive
            aria-haspopup="dialog"
            onClick={() => onRequestRemove(member.id)}
          />
        </GroupedList>
      )}

      <PhoneConfirmSheet
        open={removeUserId !== null}
        title={t('membros.removeTitle')}
        actions={[{ label: t('shared.remove'), destructive: true, onSelect: onConfirmRemove }]}
        onCancel={() => onRequestRemove(null)}
      />
    </ConfigPhoneScreen>
  );
}

/** A pending or expired invite: swipe or long-press for Reenviar / Cancelar. */
function InviteRow({
  invite,
  canManageTeam,
  onResendInvite,
  onRequestCancelInvite,
}: MembrosPhoneProps & { invite: Row }) {
  const { t } = useTranslation('settings');
  const timeLeft = inviteTimeLeftLabel(invite.expires_at, invite.status);
  const canResend = invite.status === 'expired' || invite.status === 'pending';

  const body = (trigger?: ReactNode) => (
    <div className="phone-cell__main phone-membros-invite">
      <span className="phone-cell__body">
        <span className="phone-cell__text">
          <span className="phone-cell__label">{invite.email}</span>
          <span className="phone-cell__subtitle">
            <InviteStatusBadge status={invite.status} />
            <span>{inviteRoleLabel(invite.role)}</span>
            {timeLeft && (
              <span className="phone-membros-invite__time">
                <Clock aria-hidden="true" />
                {timeLeft}
              </span>
            )}
          </span>
        </span>
        {trigger}
      </span>
    </div>
  );

  if (!canManageTeam) return <li className="phone-cell">{body()}</li>;

  const resend = () => onResendInvite(invite);
  const cancel = () => onRequestCancelInvite(invite.id);
  const swipeActions: SwipeAction[] = [
    ...(canResend ? [{ label: t('membros.resend'), tone: 'ink' as const, onAction: resend }] : []),
    { label: t('actions.cancel'), tone: 'destructive', onAction: cancel },
  ];
  const menuActions: ContextMenuAction[] = [
    ...(canResend ? [{ label: t('membros.resend'), onSelect: resend }] : []),
    { label: t('membros.phone.cancelInvite'), destructive: true, onSelect: cancel },
  ];

  return (
    <SwipeRow as="li" className="phone-cell" trailingActions={swipeActions}>
      <ContextMenu
        label={t('membros.phone.inviteActions', { email: invite.email })}
        sections={[menuActions]}
      >
        {({ triggerProps }) =>
          body(
            <button
              {...triggerProps}
              className="phone-membros-more"
              aria-label={t('membros.phone.moreInviteActions', { email: invite.email })}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>,
          )
        }
      </ContextMenu>
    </SwipeRow>
  );
}

/** The invite form as a sheet: e-mail, role, send. Same handler as the desktop dialog. */
function InviteSheet({
  inviteOpen,
  onInviteOpenChange,
  inviteEmail,
  onInviteEmailChange,
  inviteRole,
  onInviteRoleChange,
  inviteLoading,
  onInvite,
  canAssignRoles,
  workspaceRoles,
}: MembrosPhoneProps) {
  const { t } = useTranslation('settings');
  // Same options as the desktop invite Select: only a chassis owner/admin sees Admin
  // and the custom papéis (invite-user refuses both for anyone else).
  const roleOptions: CheckListOption<string>[] = [
    ...(canAssignRoles ? [{ value: 'admin', label: t('invite.roles.admin') }] : []),
    { value: 'agent', label: t('invite.roles.agent') },
    ...(canAssignRoles
      ? workspaceRoles.map((r) => ({ value: `custom:${r.id}`, label: r.nome }))
      : []),
  ];
  return (
    <BottomSheet
      open={inviteOpen}
      onOpenChange={onInviteOpenChange}
      title={t('membros.inviteTitle')}
      detents={['large']}
    >
      <GroupedList
        aria-label={t('membros.phone.inviteAria')}
        footer={canAssignRoles ? undefined : t('membros.onlyOwnersAdmins')}
      >
        <FormRow
          label={t('membros.phone.email')}
          input={{
            type: 'email',
            inputMode: 'email',
            autoComplete: 'email',
            autoCapitalize: 'none',
            placeholder: t('membros.phone.emailPlaceholder'),
            value: inviteEmail,
            onChange: (e) => onInviteEmailChange(e.target.value),
          }}
        />
        <PickerCell<string>
          label={t('membros.role')}
          options={roleOptions}
          value={inviteRole}
          onChange={(value) => {
            if (value) onInviteRoleChange(value);
          }}
        />
      </GroupedList>
      <div className="phone-membros-sheet-actions">
        <button
          type="button"
          className="phone-config-primary phone-config-primary--block"
          disabled={inviteLoading}
          aria-busy={inviteLoading || undefined}
          onClick={onInvite}
        >
          {t('membros.sendInvite')}
        </button>
      </div>
    </BottomSheet>
  );
}
