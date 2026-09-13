import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { stripFinancialFields } from '@/lib/financialAccess';
import { supabase } from '@/lib/supabase';
import { inviteUser } from '@/services/invite';
import { addMembro, getWorkspaceUsers, setMembroCrmUser, updateMembro, type Membro } from '@/store';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { inviteSuccessMessage } from '../configuracao/inviteHelpers';
import { InviteSection } from './InviteSection';
import { computeSeatState, derivePendingInvites, membroInviteErrorMessage } from './inviteSupport';
import { MEMBRO_FORM_DEFAULTS, membroSchema, type MembroFormValues } from './membroForm';

interface MembroFormDialogProps {
  open: boolean;
  membro: Membro | null;
  onOpenChange: (open: boolean) => void;
}

export function MembroFormDialog({ open, membro, onOpenChange }: MembroFormDialogProps) {
  const qc = useQueryClient();
  const { canSeeFinancials, can, workspaceRole, profile } = useAuth();
  const canManageWorkspace = can('equipe', 'editar') === true;
  const canAssignRoles = workspaceRole === 'owner' || workspaceRole === 'admin';
  const [saving, setSaving] = useState(false);
  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: MEMBRO_FORM_DEFAULTS,
  });
  const inviteEnabled = useWatch({ control: form.control, name: 'inviteEnabled' });
  const crmUserId = useWatch({ control: form.control, name: 'crmUserId' });

  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
    enabled: canManageWorkspace,
  });
  const { limits, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  const { data: pendingInviteRows = [] } = useQuery({
    queryKey: ['invites', 'equipe-pending', profile?.conta_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invites')
        .select('id, email, role, membro_id, expires_at, status')
        .eq('conta_id', profile!.conta_id)
        .eq('status', 'pending');
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManageWorkspace && !!profile?.conta_id,
  });
  const { display: pendingInvites, seatCount: pendingSeatCount } = useMemo(
    () => derivePendingInvites(pendingInviteRows),
    [pendingInviteRows],
  );
  const pendingByMembroId = useMemo(
    () =>
      new Map(
        pendingInvites
          .filter((invite) => invite.membro_id != null)
          .map((invite) => [invite.membro_id as number, invite]),
      ),
    [pendingInvites],
  );
  const seat = computeSeatState({
    isLoading: limitsLoading,
    isUnlimited,
    maxTeamMembers: limits === null ? undefined : limits.max_team_members,
    membersCount: workspaceUsers.length,
    pendingCount: pendingSeatCount,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      membro
        ? {
            ...MEMBRO_FORM_DEFAULTS,
            nome: membro.nome,
            cargo: membro.cargo || '',
            tipo: membro.tipo,
            custo: membro.custo_mensal ? String(membro.custo_mensal) : '',
            diaPag: membro.data_pagamento ? String(membro.data_pagamento) : '',
            crmUserId: membro.crm_user_id ?? '',
          }
        : MEMBRO_FORM_DEFAULTS,
    );
  }, [form, membro, open]);

  // The dialog can hold a custo_mensal value in form state. On live
  // revocation, close it rather than let the value linger on screen.
  useEffect(() => {
    if (canSeeFinancials !== true) onOpenChange(false);
  }, [canSeeFinancials, onOpenChange]);

  const onSubmit = async (values: MembroFormValues) => {
    const diaPag = values.diaPag ? parseInt(values.diaPag, 10) : undefined;
    setSaving(true);
    try {
      const payload: Omit<Membro, 'id' | 'user_id' | 'conta_id' | 'avatar_url'> = {
        nome: values.nome,
        cargo: values.cargo,
        tipo: values.tipo,
        custo_mensal: values.custo ? Number(values.custo) : null,
        data_pagamento: diaPag,
      };
      const safePayload = stripFinancialFields(payload, canSeeFinancials, ['custo_mensal']);
      const desiredCrmUser =
        values.crmUserId === '' || values.crmUserId == null ? null : values.crmUserId;
      let membroId: number | undefined;

      if (membro?.id) {
        const currentCrmUser = membro.crm_user_id ?? null;
        if (desiredCrmUser !== currentCrmUser) {
          await setMembroCrmUser(membro.id, desiredCrmUser);
        }
        await updateMembro(membro.id, safePayload);
        membroId = membro.id;
      } else {
        const created = await addMembro({
          ...safePayload,
          avatar_url: '',
        } as Omit<Membro, 'id' | 'user_id' | 'conta_id'>);
        membroId = created.id;
      }

      const wantsInvite =
        values.inviteEnabled && canManageWorkspace && membroId != null && desiredCrmUser === null;
      if (wantsInvite) {
        try {
          const encodedRole = values.inviteRole;
          const isCustomRole = encodedRole.startsWith('custom:');
          const role = isCustomRole ? 'agent' : (encodedRole as 'admin' | 'agent');
          const result = isCustomRole
            ? await inviteUser(values.inviteEmail.trim(), role, membroId, encodedRole.slice(7))
            : await inviteUser(values.inviteEmail.trim(), role, membroId);
          toast.success(inviteSuccessMessage(result));
          captureEvent('invite_sent', { source: 'equipe' });
        } catch (err) {
          toast.error(membroInviteErrorMessage(err));
        }
      } else {
        toast.success(membro?.id ? 'Membro atualizado' : 'Membro adicionado');
      }

      qc.invalidateQueries({ queryKey: ['membros'] });
      qc.invalidateQueries({ queryKey: ['workspace-users'] });
      qc.invalidateQueries({ queryKey: ['invites'] });
      onOpenChange(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} onConfirmClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{membro ? 'Editar Membro' : 'Adicionar Membro'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cargo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cargo *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="clt">CLT</SelectItem>
                      <SelectItem value="freelancer_mensal">Freelancer Mensal</SelectItem>
                      <SelectItem value="freelancer_demanda">Freelancer Demanda</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {canSeeFinancials === true && (
              <FormField
                control={form.control}
                name="custo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custo Mensal (R$)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={0.01} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="diaPag"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dia de Pagamento (1-31)</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={31} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {canManageWorkspace && !!membro && (
              <FormField
                control={form.control}
                name="crmUserId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta CRM</FormLabel>
                    <Select
                      value={field.value ? field.value : '__none__'}
                      onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Não vinculado" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Não vinculado</SelectItem>
                        {workspaceUsers.map((user: { id: string; nome?: string }) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.nome || user.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Vincular um membro a um usuário do workspace permite que ele acesse o CRM e
                      veja suas atribuições.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {canManageWorkspace && !membro?.crm_user_id && (
              <InviteSection
                form={form}
                seat={seat}
                pendingInvite={membro?.id ? (pendingByMembroId.get(membro.id) ?? null) : null}
                canManageWorkspace={canManageWorkspace}
                canAssignRoles={canAssignRoles}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Spinner size="sm" />}{' '}
                {inviteEnabled && !crmUserId ? 'Salvar e convidar' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
