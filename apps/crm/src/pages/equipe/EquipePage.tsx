import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus,
  Edit2,
  Trash2,
  Upload,
  Info,
  HelpCircle,
  Search,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/help/HelpTooltip';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  getMembros,
  addMembro,
  updateMembro,
  removeMembro,
  getWorkspaceUsers,
  setMembroCrmUser,
  getInitials,
  type Membro,
} from '../../store';
import { useAuth } from '../../context/AuthContext';
import { avatarColorClass } from '@/lib/avatarColor';
import {
  assertNoFinancialColumns,
  formatFinancialBRL,
  stripFinancialFields,
} from '@/lib/financialAccess';
import { membroSchema, MEMBRO_FORM_DEFAULTS, type MembroFormValues } from './membroForm';
import { InviteSection } from './InviteSection';
import { computeSeatState, membroInviteErrorMessage } from './inviteSupport';
import { inviteUser } from '../../services/invite';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { computeEffectiveInviteStatus, inviteSuccessMessage } from '../configuracao/inviteHelpers';
import { supabase } from '../../lib/supabase';
import { captureEvent } from '@/lib/analytics';

type FilterTipo = 'todos' | 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
type SortKey = 'nome' | 'custo_maior' | 'custo_menor';

const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

export default function EquipePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role, canSeeFinancials, workspaceRole, membershipResolved, profile } = useAuth();
  const isAgent = role === 'agent';
  const canManageWorkspace =
    membershipResolved === true && (workspaceRole === 'owner' || workspaceRole === 'admin');

  const [filter, setFilter] = useState<FilterTipo>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('nome');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Membro | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: MEMBRO_FORM_DEFAULTS,
  });

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
    enabled: !isAgent,
  });
  const { limits, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['invites', 'equipe-pending', profile?.conta_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('invites')
        .select('id, email, role, membro_id, expires_at, status')
        .eq('conta_id', profile!.conta_id)
        .eq('status', 'pending');
      // Locally-expired invites must not render as pending.
      return computeEffectiveInviteStatus(data ?? []).filter((i) => i.status === 'pending');
    },
    enabled: canManageWorkspace && !!profile?.conta_id,
  });
  const pendingByMembroId = new Map(
    pendingInvites.filter((i) => i.membro_id != null).map((i) => [i.membro_id as number, i]),
  );
  const seat = computeSeatState({
    isLoading: limitsLoading,
    isUnlimited,
    maxTeamMembers: limits === null ? undefined : limits.max_team_members,
    membersCount: workspaceUsers.length,
    pendingCount: pendingInvites.length,
  });
  const totalCost = membros.reduce((s, m) => s + (m.custo_mensal ?? 0), 0);

  // The edit/add modal can hold a custo_mensal value in its form state. On
  // live revocation, close it rather than let the value linger on screen.
  useEffect(() => {
    if (canSeeFinancials !== true) setModalOpen(false);
  }, [canSeeFinancials]);

  const filtered = membros
    .filter((m) => filter === 'todos' || m.tipo === filter)
    .filter(
      (m) =>
        !search ||
        m.nome.toLowerCase().includes(search.toLowerCase()) ||
        m.cargo?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === 'nome') return a.nome.localeCompare(b.nome);
      if (sort === 'custo_maior') return (b.custo_mensal ?? 0) - (a.custo_mensal ?? 0);
      return (a.custo_mensal ?? 0) - (b.custo_mensal ?? 0);
    });

  const openAdd = () => {
    setEditing(null);
    form.reset(MEMBRO_FORM_DEFAULTS);
    setModalOpen(true);
  };

  const openEdit = (m: Membro) => {
    setEditing(m);
    form.reset({
      ...MEMBRO_FORM_DEFAULTS,
      nome: m.nome,
      cargo: m.cargo || '',
      tipo: m.tipo,
      custo: m.custo_mensal ? String(m.custo_mensal) : '',
      diaPag: m.data_pagamento ? String(m.data_pagamento) : '',
      crmUserId: m.crm_user_id ?? '',
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: MembroFormValues) => {
    const diaPag = values.diaPag ? parseInt(values.diaPag, 10) : undefined;
    setSaving(true);
    try {
      const payload: Omit<Membro, 'id' | 'user_id' | 'conta_id'> = {
        nome: values.nome,
        cargo: values.cargo,
        tipo: values.tipo,
        custo_mensal: values.custo ? Number(values.custo) : null,
        avatar_url: '',
        data_pagamento: diaPag,
      };
      const safePayload = stripFinancialFields(payload, canSeeFinancials, ['custo_mensal']);
      let membroId: number | undefined;
      if (editing?.id) {
        const desiredCrmUser =
          values.crmUserId === '' || values.crmUserId == null ? null : values.crmUserId;
        const currentCrmUser = editing.crm_user_id ?? null;
        if (desiredCrmUser !== currentCrmUser) {
          await setMembroCrmUser(editing.id, desiredCrmUser);
        }
        await updateMembro(editing.id, safePayload);
        membroId = editing.id;
      } else {
        const created = await addMembro(safePayload as Omit<Membro, 'id' | 'user_id' | 'conta_id'>);
        membroId = created.id;
      }

      // The invite is a second, non-atomic operation: a failure here must not
      // roll back or hide the saved membro.
      const wantsInvite =
        values.inviteEnabled && canManageWorkspace && membroId != null && !editing?.crm_user_id;
      if (wantsInvite) {
        try {
          const result = await inviteUser(values.inviteEmail.trim(), values.inviteRole, membroId);
          toast.success(inviteSuccessMessage(result));
          captureEvent('invite_sent', { source: 'equipe' });
        } catch (err) {
          toast.error(membroInviteErrorMessage(err));
        }
      } else {
        toast.success(editing?.id ? 'Membro atualizado' : 'Membro adicionado');
      }

      qc.invalidateQueries({ queryKey: ['membros'] });
      qc.invalidateQueries({ queryKey: ['workspace-users'] });
      qc.invalidateQueries({ queryKey: ['invites'] });
      setModalOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeMembro(deleteId);
      toast.success('Membro removido');
      qc.invalidateQueries({ queryKey: ['membros'] });
    } catch {
      toast.error('Erro ao remover');
    }
    setDeleteId(null);
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        try {
          assertNoFinancialColumns(rows, canSeeFinancials, ['custo_mensal']);
        } catch (e) {
          toast.error((e as Error).message);
          return;
        }
        let count = 0;
        for (const row of rows) {
          if (!row.nome || !row.cargo) continue;
          try {
            const tipo = (
              ['clt', 'freelancer_mensal', 'freelancer_demanda'].includes(row.tipo)
                ? row.tipo
                : 'clt'
            ) as Membro['tipo'];
            const rowPayload = {
              nome: row.nome,
              cargo: row.cargo,
              tipo,
              custo_mensal: row.custo_mensal ? Number(row.custo_mensal) : null,
              avatar_url: '',
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
            };
            await addMembro(
              stripFinancialFields(rowPayload, canSeeFinancials, ['custo_mensal']) as Omit<
                Membro,
                'id' | 'user_id' | 'conta_id'
              >,
            );
            count++;
          } catch {
            /* skip row */
          }
        }
        toast.success(
          `${count} membro${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`,
        );
        qc.invalidateQueries({ queryKey: ['membros'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div
          className="header-title"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <h1>Equipe</h1>
          <HelpTooltip
            content={
              <div className="space-y-2">
                <p>
                  <strong>Membros</strong> = pessoas da equipe (designers, redatores, etc). Servem
                  para custos e atribuição de tarefas em fluxos.
                </p>
                <p>
                  <strong>Usuários do workspace</strong> = contas com acesso ao CRM. Gerencie em
                  Configurações → Workspace.
                </p>
                <p>
                  Para que um membro acesse o CRM, vincule-o a um usuário do workspace no formulário
                  de edição.
                </p>
              </div>
            }
          >
            <span style={{ display: 'flex' }}>
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
          </HelpTooltip>
        </div>
        <div className="header-actions">
          {!isAgent && (
            <HelpTooltip content="Colunas CSV: nome*, cargo*, tipo (clt|freelancer_mensal|freelancer_demanda), custo_mensal, data_pagamento">
              <span style={{ display: 'flex' }}>
                <HelpCircle
                  className="h-4 w-4"
                  style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                />
              </span>
            </HelpTooltip>
          )}
          {!isAgent && (
            <Button variant="outline" onClick={handleCSVImport}>
              <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV
            </Button>
          )}
          {!isAgent && (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Adicionar Membro
            </Button>
          )}
        </div>
      </div>

      {isAgent && (
        <div style={{ marginBottom: '1rem' }}>
          <RoleRestrictionNotice
            title="Visualização limitada"
            description="Apenas administradores e proprietários podem adicionar, editar ou remover membros da equipe."
          />
        </div>
      )}

      <StatCardGrid style={{ marginBottom: '1.5rem' }}>
        <StatCard label="Total de membros" value={membros.length} icon={UsersRound} tone="blue" />
        {canSeeFinancials === true && (
          <StatCard
            label="Custo mensal total"
            value={formatFinancialBRL(totalCost, canSeeFinancials)}
            icon={Wallet}
            tone="violet"
            compactValue
          />
        )}
      </StatCardGrid>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search
            className="h-4 w-4"
            style={{
              position: 'absolute',
              left: '0.625rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <Input
            placeholder="Buscar por nome ou cargo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2rem' }}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0"
            >
              {filter === 'todos' ? 'Tipo' : TIPO_LABEL[filter]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(v) => setFilter(v as FilterTipo)}
            >
              {(['todos', 'clt', 'freelancer_mensal', 'freelancer_demanda'] as FilterTipo[]).map(
                (f) => (
                  <DropdownMenuRadioItem key={f} value={f}>
                    {f === 'todos' ? 'Todos' : TIPO_LABEL[f]}
                  </DropdownMenuRadioItem>
                ),
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nome">Nome</SelectItem>
            {canSeeFinancials === true && (
              <>
                <SelectItem value="custo_maior">Custo (maior)</SelectItem>
                <SelectItem value="custo_menor">Custo (menor)</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="team-grid">
          {filtered.map((m) => {
            const avatarClass = avatarColorClass(m.id ?? m.nome);
            return (
              <div
                key={m.id}
                className="team-card card animate-up"
                style={{ padding: '1.25rem 1rem' }}
              >
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div
                    className={`avatar ${avatarClass}`}
                    style={{ fontWeight: 700, width: 44, height: 44, fontSize: '1rem' }}
                  >
                    {getInitials(m.nome)}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <button
                      className="client-link"
                      onClick={() => navigate(`/equipe/${m.id}`)}
                      style={{ fontWeight: 600, textAlign: 'left', lineHeight: 1.2 }}
                    >
                      {m.nome}
                    </button>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>{m.cargo}</div>
                    <div
                      style={{
                        marginTop: 2,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.25rem',
                        alignItems: 'center',
                      }}
                    >
                      <Badge variant="neutral" size="sm" style={{ pointerEvents: 'none' }}>
                        {TIPO_LABEL[m.tipo]}
                      </Badge>
                      {!isAgent &&
                        !m.crm_user_id &&
                        (pendingByMembroId.has(m.id!) ? (
                          <Badge variant="warning" size="sm">
                            convite pendente
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="sm">
                            sem conta vinculada
                          </Badge>
                        ))}
                    </div>
                  </div>

                  <div className="flex gap-1" style={{ marginLeft: 'auto' }}>
                    {!isAgent && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => openEdit(m)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {m.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteId(m.id!)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Membro' : 'Adicionar Membro'}</DialogTitle>
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
              {canManageWorkspace && !!editing && (
                <FormField
                  control={form.control}
                  name="crmUserId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Conta CRM</FormLabel>
                      <Select
                        value={field.value ? field.value : '__none__'}
                        onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Não vinculado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">Não vinculado</SelectItem>
                          {workspaceUsers.map((u: { id: string; nome?: string }) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.nome || u.id}
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
              {canManageWorkspace && !editing?.crm_user_id && (
                <InviteSection
                  form={form}
                  seat={seat}
                  pendingInvite={editing?.id ? (pendingByMembroId.get(editing.id) ?? null) : null}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />}{' '}
                  {form.watch('inviteEnabled') && !editing?.crm_user_id
                    ? 'Salvar e convidar'
                    : 'Salvar'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este membro?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
