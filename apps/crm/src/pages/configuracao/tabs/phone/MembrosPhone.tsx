import { useEffect, type ReactNode } from 'react';
import { Clock, MoreHorizontal, Plus } from 'lucide-react';
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
  const isTappable = (m: Row) => canManageMember(m) || showFinancial(m);

  if (selected) {
    return <MemberScreen {...props} member={selected} onBack={sub.close} />;
  }

  return (
    <ConfigPhoneScreen
      title="Membros"
      trailing={
        canManageTeam ? (
          <PhoneIconButton
            label="Convidar"
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
          header="Membros do workspace"
          footer={
            members.some(isTappable)
              ? 'Toque em um membro para mudar a função, ligar o acesso ao financeiro ou remover.'
              : undefined
          }
        >
          {members.map((m) => {
            const self = m.id === currentUserId;
            const financial =
              m.role === 'admin' && Boolean(m.can_see_financials) ? ' · vê o financeiro' : '';
            return (
              <Cell
                key={m.id}
                className="phone-membros-cell"
                icon={<MemberAvatar member={m} />}
                label={self ? `${m.nome} (você)` : m.nome}
                subtitle={`${memberRoleLabel(m)}${financial}`}
                chevron={isTappable(m)}
                onClick={isTappable(m) ? () => sub.open(m.id) : undefined}
              />
            );
          })}
        </GroupedList>
      )}

      {invites.length > 0 && (
        <GroupedList
          header="Convites"
          footer={canManageTeam ? 'Deslize um convite para reenviar ou cancelar.' : undefined}
        >
          {invites.map((inv) => (
            <InviteRow key={inv.id} {...props} invite={inv} />
          ))}
        </GroupedList>
      )}

      <InviteSheet {...props} />

      <PhoneConfirmSheet
        open={props.cancelInviteId !== null}
        title="Cancelar convite?"
        actions={[{ label: 'Sim', destructive: true, onSelect: props.onConfirmCancelInvite }]}
        cancelLabel="Não"
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
  const canManage = canManageTeam && canActOnMember(member);
  const canEditRole = canManage && canAssignRoles;
  const showFinancial = isOwner && member.role === 'admin';
  const currentRole = memberRoleValue(member);
  // Same options as the desktop "Editar função" dialog.
  const roleOptions: CheckListOption<string>[] = [
    { value: 'admin', label: 'Admin' },
    { value: 'agent', label: 'Agente' },
    ...workspaceRoles.map((r) => ({ value: `custom:${r.id}`, label: r.nome })),
  ];

  return (
    <ConfigPhoneScreen title={member.nome} subtitle={memberRoleLabel(member)} onBack={onBack}>
      <div className="phone-membros-hero" aria-hidden="true">
        <MemberAvatar member={member} large />
      </div>

      <GroupedList aria-label="Função">
        {canEditRole ? (
          <PickerCell<string>
            label="Função"
            options={roleOptions}
            value={currentRole}
            placeholder={memberRoleLabel(member)}
            disabled={roleSaving}
            onChange={(value) => {
              if (value && value !== currentRole) void onSaveRole(member.id, value);
            }}
          />
        ) : (
          <Cell label="Função" value={memberRoleLabel(member)} />
        )}
      </GroupedList>

      {showFinancial && (
        <GroupedList aria-label="Acesso financeiro">
          <Cell
            label="Ver financeiro"
            disabled={financialAccessLoadingId === member.id}
            switch={{
              checked: Boolean(member.can_see_financials),
              onCheckedChange: (checked) => onToggleFinancialAccess(member.id, checked),
            }}
          />
        </GroupedList>
      )}

      {canManage && (
        <GroupedList aria-label="Remover">
          <Cell
            label="Remover do workspace"
            destructive
            aria-haspopup="dialog"
            onClick={() => onRequestRemove(member.id)}
          />
        </GroupedList>
      )}

      <PhoneConfirmSheet
        open={removeUserId !== null}
        title="Remover membro?"
        actions={[{ label: 'Remover', destructive: true, onSelect: onConfirmRemove }]}
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
    ...(canResend ? [{ label: 'Reenviar', tone: 'ink' as const, onAction: resend }] : []),
    { label: 'Cancelar', tone: 'destructive', onAction: cancel },
  ];
  const menuActions: ContextMenuAction[] = [
    ...(canResend ? [{ label: 'Reenviar', onSelect: resend }] : []),
    { label: 'Cancelar convite', destructive: true, onSelect: cancel },
  ];

  return (
    <SwipeRow as="li" className="phone-cell" trailingActions={swipeActions}>
      <ContextMenu label={`Ações do convite para ${invite.email}`} sections={[menuActions]}>
        {({ triggerProps }) =>
          body(
            <button
              {...triggerProps}
              className="phone-membros-more"
              aria-label={`Mais ações do convite para ${invite.email}`}
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
  // Same options as the desktop invite Select: only a chassis owner/admin sees Admin
  // and the custom papéis (invite-user refuses both for anyone else).
  const roleOptions: CheckListOption<string>[] = [
    ...(canAssignRoles ? [{ value: 'admin', label: 'Admin' }] : []),
    { value: 'agent', label: 'Agente' },
    ...(canAssignRoles
      ? workspaceRoles.map((r) => ({ value: `custom:${r.id}`, label: r.nome }))
      : []),
  ];
  return (
    <BottomSheet
      open={inviteOpen}
      onOpenChange={onInviteOpenChange}
      title="Convidar Membro"
      detents={['large']}
    >
      <GroupedList
        aria-label="Convite"
        footer={
          canAssignRoles ? undefined : 'Apenas donos e admins convidam com função elevada ou papel.'
        }
      >
        <FormRow
          label="Email"
          input={{
            type: 'email',
            inputMode: 'email',
            autoComplete: 'email',
            autoCapitalize: 'none',
            placeholder: 'nome@empresa.com',
            value: inviteEmail,
            onChange: (e) => onInviteEmailChange(e.target.value),
          }}
        />
        <PickerCell<string>
          label="Função"
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
          Enviar Convite
        </button>
      </div>
    </BottomSheet>
  );
}
