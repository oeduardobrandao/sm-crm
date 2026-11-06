import { UserPlus } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { InviteTimeLeft } from '../configuracao/inviteHelpers';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
import { getWorkspaceRoles } from '@/store';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PickerCell } from '@/components/mobile/PickerSheet';
import type { MembroFormValues } from './membroForm';
import type { SeatState } from './inviteSupport';

/** Lower-case display name of a workspace role id; unknown ids render as is. */
function roleName(t: TFunction, role: string): string {
  return role === 'owner' || role === 'admin' || role === 'agent' ? t(`shared.role.${role}`) : role;
}

function SeatMeter({ seat, previewing }: { seat: SeatState; previewing: boolean }) {
  const { t } = useTranslation('team');
  const isOwner = useIsWorkspaceOwner();
  if (seat.status === 'unlimited') return null;
  if (seat.status === 'loading' || seat.status === 'unavailable') {
    return (
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
        {t('inviteSection.loadingSeats')}
      </p>
    );
  }
  const doPreview = previewing && seat.status === 'ok';
  const displayUsed = doPreview ? seat.used + 1 : seat.used;
  const displayRemaining = doPreview
    ? Math.max(0, (seat.remaining ?? 0) - 1)
    : (seat.remaining ?? 0);
  return (
    <div style={{ marginTop: 10 }}>
      <UsageMeter
        label=""
        used={displayUsed}
        limit={seat.limit}
        showUpgradeCta={isOwner}
        valueText={t(doPreview ? 'inviteSection.seatsAfterInvite' : 'inviteSection.seatsUsed', {
          used: displayUsed,
          limit: seat.limit,
        })}
        subText={t('inviteSection.remaining', { count: displayRemaining })}
      />
    </div>
  );
}

/**
 * "Acesso ao CRM" section of the membro dialog: opt-in workspace invite with
 * a seat meter. Renders the pending-invite notice instead when the membro
 * already has one (resend/cancel live in Configurações → Workspace).
 */
export function InviteSection({
  form,
  seat,
  pendingInvite,
  canManageWorkspace,
  canAssignRoles,
  phone = false,
}: {
  form: UseFormReturn<MembroFormValues>;
  seat: SeatState;
  pendingInvite: { email: string; role: string; expires_at: string } | null;
  /**
   * Same prop EquipePage already computes for itself — gates the
   * custom-papel `getWorkspaceRoles` fetch below so a member who can't
   * manage the workspace never fires it.
   *
   * EquipePage now computes it as `can('equipe', 'editar') === true`
   * (Task 14), the same check MembrosTab.tsx uses for its equivalent
   * controls and the same one `manage-workspace-user`/`invite-user` enforce
   * server-side. Before that conversion the caller used the coarse
   * `workspaceRole === 'owner' || 'admin'` literal, which hid this section
   * from a custom papel granted `equipe:editar` even though the server would
   * have accepted its writes. This prop still just threads through whatever
   * the caller computes.
   */
  canManageWorkspace: boolean;
  /**
   * The CHASSIS check (`workspaceRole` is owner/admin), deliberately NOT the
   * same thing as `canManageWorkspace` above (`equipe:editar`).
   * `invite-user/index.ts` requires both to invite with an elevated role:
   * `isPrivilegedActor = caller.role === 'owner' || 'admin'`, and a
   * non-privileged actor sending `role !== 'agent'` or any `role_id` gets
   * "Apenas donos e admins podem convidar com função elevada ou papel."
   * Offering those options to a custom `equipe:editar` actor was a dead end:
   * the invite only failed after being submitted. Same rule, same prop name,
   * as MembrosTab's own invite dialog.
   */
  canAssignRoles: boolean;
  /** Grouped phone rows (switch cell, form rows, checkmark picker) instead of the desktop block. */
  phone?: boolean;
}) {
  const { t } = useTranslation('team');
  const { data: workspaceRoles = [] } = useQuery({
    queryKey: ['workspace-roles'],
    queryFn: getWorkspaceRoles,
    enabled: canManageWorkspace,
  });

  const sectionTitle = (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.8rem',
        fontWeight: 600,
      }}
    >
      <UserPlus className="h-3.5 w-3.5" /> {t('inviteSection.title')}
    </span>
  );

  if (phone) {
    return (
      <PhoneInviteSection
        form={form}
        seat={seat}
        pendingInvite={pendingInvite}
        canAssignRoles={canAssignRoles}
        workspaceRoles={workspaceRoles}
      />
    );
  }

  if (pendingInvite) {
    return (
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
        {sectionTitle}
        <div
          style={{
            marginTop: 8,
            borderRadius: 8,
            padding: '9px 11px',
            fontSize: '0.75rem',
            lineHeight: 1.5,
            background: 'var(--surface-1)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          <Trans
            t={t}
            i18nKey="inviteSection.pendingNotice"
            values={{ email: pendingInvite.email, role: roleName(t, pendingInvite.role) }}
            components={{
              b: <strong />,
              time: <InviteTimeLeft expiresAt={pendingInvite.expires_at} status="pending" />,
            }}
          />
        </div>
      </div>
    );
  }

  const inviteEnabled = form.watch('inviteEnabled');
  const switchDisabled = seat.status !== 'ok' && seat.status !== 'unlimited';

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {sectionTitle}
        <FormField
          control={form.control}
          name="inviteEnabled"
          render={({ field }) => (
            <Switch
              checked={field.value}
              disabled={switchDisabled}
              onCheckedChange={field.onChange}
              aria-label={t('inviteSection.inviteLabel')}
            />
          )}
        />
      </div>
      <p
        style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}
      >
        <strong>{t('inviteSection.inviteLabel')}</strong>.{' '}
        {inviteEnabled ? t('inviteSection.inviteOn') : t('inviteSection.inviteOff')}
      </p>
      {inviteEnabled && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField
            control={form.control}
            name="inviteEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('inviteSection.email')}</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="inviteRole"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('shared.workspaceRole')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {canAssignRoles && (
                      <SelectItem value="admin">{t('shared.roleOption.admin')}</SelectItem>
                    )}
                    <SelectItem value="agent">{t('shared.roleOption.agent')}</SelectItem>
                    {canAssignRoles &&
                      workspaceRoles.map((r) => (
                        <SelectItem key={r.id} value={`custom:${r.id}`}>
                          {r.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {!canAssignRoles && (
                  <p className="text-xs text-[color:var(--text-muted)]">
                    {t('inviteSection.rolesRestricted')}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <SeatMeter seat={seat} previewing={inviteEnabled} />
      {seat.status === 'full' && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: '0.72rem',
            lineHeight: 1.5,
            color: 'var(--danger-text)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-color)',
          }}
        >
          {t('inviteSection.seatsFull')}
        </div>
      )}
    </div>
  );
}

function SeatFullNotice() {
  const { t } = useTranslation('team');
  return (
    <div
      style={{
        margin: '-8px 0 20px',
        borderRadius: 12,
        padding: '8px 11px',
        fontSize: '0.8rem',
        lineHeight: 1.5,
        color: 'var(--danger-text)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border-color)',
      }}
    >
      {t('inviteSection.seatsFull')}
    </div>
  );
}

/** "Acesso ao CRM" on phones: the same states and copy as the desktop block, as grouped rows. */
function PhoneInviteSection({
  form,
  seat,
  pendingInvite,
  canAssignRoles,
  workspaceRoles,
}: {
  form: UseFormReturn<MembroFormValues>;
  seat: SeatState;
  pendingInvite: { email: string; role: string; expires_at: string } | null;
  canAssignRoles: boolean;
  workspaceRoles: { id: string; nome: string }[];
}) {
  const { t } = useTranslation('team');
  if (pendingInvite) {
    return (
      <GroupedList
        header={t('inviteSection.title')}
        footer={
          <Trans
            t={t}
            i18nKey="inviteSection.pendingFooter"
            components={{
              time: <InviteTimeLeft expiresAt={pendingInvite.expires_at} status="pending" />,
            }}
          />
        }
      >
        <Cell
          icon={<UserPlus aria-hidden="true" />}
          label={t('inviteSection.pendingCell')}
          subtitle={pendingInvite.email}
          value={roleName(t, pendingInvite.role)}
        />
      </GroupedList>
    );
  }

  const inviteEnabled = form.watch('inviteEnabled');
  const inviteRole = form.watch('inviteRole');
  const switchDisabled = seat.status !== 'ok' && seat.status !== 'unlimited';
  const roleOptions = [
    ...(canAssignRoles ? [{ value: 'admin', label: t('shared.roleOption.admin') }] : []),
    { value: 'agent', label: t('shared.roleOption.agent') },
    ...(canAssignRoles
      ? workspaceRoles.map((r) => ({ value: `custom:${r.id}`, label: r.nome }))
      : []),
  ];

  return (
    <>
      <GroupedList
        header={t('inviteSection.title')}
        footer={inviteEnabled ? t('inviteSection.inviteOn') : t('inviteSection.inviteOff')}
      >
        <Cell
          label={t('inviteSection.inviteLabel')}
          disabled={switchDisabled}
          switch={{
            checked: inviteEnabled,
            onCheckedChange: (v) => form.setValue('inviteEnabled', v, { shouldDirty: true }),
          }}
        />
        {inviteEnabled && (
          <FormRow
            label={t('inviteSection.email')}
            error={form.formState.errors.inviteEmail?.message}
            input={{
              ...form.register('inviteEmail'),
              type: 'email',
              inputMode: 'email',
              autoComplete: 'email',
              autoCapitalize: 'none',
            }}
          />
        )}
        {inviteEnabled && (
          <PickerCell
            label={t('shared.workspaceRole')}
            subtitle={canAssignRoles ? undefined : t('inviteSection.rolesRestricted')}
            options={roleOptions}
            value={inviteRole || null}
            onChange={(v) => v && form.setValue('inviteRole', v, { shouldDirty: true })}
          />
        )}
      </GroupedList>
      <div style={{ margin: '-8px 0 20px' }}>
        <SeatMeter seat={seat} previewing={inviteEnabled} />
      </div>
      {seat.status === 'full' && <SeatFullNotice />}
    </>
  );
}
