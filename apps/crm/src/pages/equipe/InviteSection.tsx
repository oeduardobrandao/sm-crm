import { UserPlus } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
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
import type { MembroFormValues } from './membroForm';
import type { SeatState } from './inviteSupport';

const ROLE_PT: Record<string, string> = { owner: 'dono', admin: 'admin', agent: 'agente' };

function SeatMeter({ seat, previewing }: { seat: SeatState; previewing: boolean }) {
  const isOwner = useIsWorkspaceOwner();
  if (seat.status === 'unlimited') return null;
  if (seat.status === 'loading' || seat.status === 'unavailable') {
    return (
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Carregando vagas do plano...
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
        valueText={`${displayUsed} de ${seat.limit} ${
          doPreview ? 'vagas após este convite' : 'vagas do plano usadas'
        }`}
        subText={`${displayRemaining} restante${displayRemaining === 1 ? '' : 's'}`}
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
}: {
  form: UseFormReturn<MembroFormValues>;
  seat: SeatState;
  pendingInvite: { email: string; role: string; expires_at: string } | null;
}) {
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
      <UserPlus className="h-3.5 w-3.5" /> Acesso ao CRM
    </span>
  );

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
          Convite pendente para <strong>{pendingInvite.email}</strong> (
          {ROLE_PT[pendingInvite.role] ?? pendingInvite.role})
          <InviteTimeLeft expiresAt={pendingInvite.expires_at} status="pending" />. Reenviar ou
          cancelar em Configurações → Workspace.
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
              aria-label="Convidar para o workspace"
            />
          )}
        />
      </div>
      <p
        style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}
      >
        <strong>Convidar para o workspace</strong>.{' '}
        {inviteEnabled
          ? 'A pessoa receberá um convite por e-mail e ocupará 1 vaga do plano. Quando aceitar, a conta será vinculada a este membro automaticamente.'
          : 'Sem convite, o membro serve para custos e atribuições, mas não faz login no CRM. Você pode convidar depois.'}
      </p>
      {inviteEnabled && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField
            control={form.control}
            name="inviteEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email *</FormLabel>
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
                <FormLabel>Função no workspace</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="agent">Agente</SelectItem>
                  </SelectContent>
                </Select>
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
          Todas as vagas do plano estão em uso. O membro pode ser salvo normalmente; para convidá-lo
          ao CRM, faça upgrade do plano ou remova um usuário.
        </div>
      )}
    </div>
  );
}
