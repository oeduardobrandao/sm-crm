import { useMemo, useState } from 'react';
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
import { TableSkeleton } from '@/components/ui/skeletons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { addMembro, getMembros, removeMembro, type Membro } from '../../store';
import { useAuth } from '../../context/AuthContext';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import {
  assertNoFinancialColumns,
  formatFinancialBRL,
  stripFinancialFields,
} from '@/lib/financialAccess';
import { derivePendingInvites } from './inviteSupport';
import { useOpenParam } from '../../hooks/useOpenParam';
import { supabase } from '../../lib/supabase';
import { MembroFormDialog } from './MembroFormDialog';
import {
  EquipePhone,
  TIPO_LABEL,
  type EquipeFilter as FilterTipo,
  type EquipeSort as SortKey,
} from './phone/EquipePhone';

export default function EquipePage() {
  const qc = useQueryClient();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { canSeeFinancials, can, profile } = useAuth();
  // Legacy chassis-role checks (agent-vs-not, owner-or-admin) both collapsed
  // onto the real authorization boundary: `manage-workspace-user`/
  // `invite-user` already enforce `equipe:editar` server-side (Task 11). A
  // custom role granted that permission has the 'agent' chassis role but
  // must reach the same UI a legacy admin does — the coarse checks blocked
  // it even though the server would have allowed the write.
  const canEditTeam = can('equipe', 'editar') === true;
  const canManageWorkspace = canEditTeam;

  const [filter, setFilter] = useState<FilterTipo>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('nome');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Membro | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
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
  const { display: pendingInvites } = useMemo(
    () => derivePendingInvites(pendingInviteRows),
    [pendingInviteRows],
  );
  const pendingByMembroId = new Map(
    pendingInvites.filter((i) => i.membro_id != null).map((i) => [i.membro_id as number, i]),
  );
  const totalCost = membros.reduce((s, m) => s + (m.custo_mensal ?? 0), 0);

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
    setModalOpen(true);
  };

  useOpenParam('novo', openAdd);

  const openEdit = (m: Membro) => {
    setEditing(m);
    setModalOpen(true);
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
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
            };
            await addMembro(
              stripFinancialFields(rowPayload, canSeeFinancials, ['custo_mensal']) as Omit<
                Membro,
                'id' | 'user_id' | 'conta_id' | 'avatar_url'
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

  const dialogs = (
    <>
      <MembroFormDialog
        open={modalOpen}
        membro={editing}
        membros={membros}
        onOpenChange={setModalOpen}
      />

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
    </>
  );

  const infoTooltip = (
    <HelpTooltip
      content={
        <div className="space-y-2">
          <p>
            <strong>Membros</strong> = pessoas da equipe (designers, redatores, etc). Servem para
            custos e atribuição de tarefas em fluxos.
          </p>
          <p>
            <strong>Usuários do workspace</strong> = contas com acesso ao CRM. Gerencie em
            Configurações → Workspace.
          </p>
          <p>
            Para que um membro acesse o CRM, vincule-o a um usuário do workspace no formulário de
            edição.
          </p>
        </div>
      }
    >
      <span style={{ display: 'flex' }}>
        <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
      </span>
    </HelpTooltip>
  );
  const headerActions = canEditTeam ? (
    <>
      <HelpTooltip content="Colunas CSV: nome*, cargo*, tipo (clt|freelancer_mensal|freelancer_demanda), custo_mensal, data_pagamento">
        <span style={{ display: 'flex' }}>
          <HelpCircle
            className="h-4 w-4"
            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
          />
        </span>
      </HelpTooltip>
      <Button
        variant="outline"
        size="icon"
        onClick={handleCSVImport}
        className="header-actions-icon-only"
      >
        <Upload className="h-4 w-4" />
      </Button>
      <Button variant="outline" onClick={handleCSVImport} className="header-actions-full-only">
        <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV
      </Button>
    </>
  ) : null;
  const primaryAction = canEditTeam ? (
    <Button onClick={openAdd}>
      <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Adicionar Membro
    </Button>
  ) : null;

  const inToolbar = usePageToolbar({
    title: 'Equipe',
    titleAccessory: infoTooltip,
    actions: headerActions,
    primary: primaryAction,
  });

  // Below 768px: the phone list (PLAN F2d). It replaces the old team-grid cards and the
  // shadcn filter sheet; 768px and up keep the table with Tipo and Ordenar inline.
  if (!isDesktop) {
    return (
      <>
        <EquipePhone
          isLoading={isLoading}
          membros={filtered}
          totalMembros={membros.length}
          totalCost={totalCost}
          canSeeFinancials={canSeeFinancials}
          canEditTeam={canEditTeam}
          pendingInviteIds={new Set(pendingByMembroId.keys())}
          filter={filter}
          onFilterChange={setFilter}
          sort={sort}
          onSortChange={setSort}
          search={search}
          onSearchChange={setSearch}
          onAdd={openAdd}
          onImport={handleCSVImport}
          onOpen={(m) => m.id && navigate(`/equipe/${m.id}`)}
          onEdit={openEdit}
          onDelete={setDeleteId}
        />
        {dialogs}
      </>
    );
  }

  return (
    // Under Vidro the panel already pads the content.
    <div style={inToolbar ? undefined : { padding: '1.5rem' }}>
      {!inToolbar && (
        <div className="header">
          <div
            className="header-title"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <h1>Equipe</h1>
            {infoTooltip}
          </div>
          <div className="header-actions">
            {headerActions}
            {primaryAction}
          </div>
        </div>
      )}

      {!canEditTeam && (
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
        <div className="contents">
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
      </div>

      {isLoading ? (
        <TableSkeleton columns={4} />
      ) : (
        <div className="card animate-up" style={{ padding: '0.25rem 0', overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ paddingLeft: '1rem' }}>Membro</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Vínculo</TableHead>
                {canEditTeam && <TableHead style={{ width: 88 }} />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow
                  key={m.id}
                  onClick={() => m.id && navigate(`/equipe/${m.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <TableCell style={{ paddingLeft: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <PessoaAvatar
                        nome={m.nome}
                        fotoUrl={m.avatar_url}
                        seed={m.id}
                        size={28}
                        className="font-bold"
                      />
                      <button
                        className="client-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/equipe/${m.id}`);
                        }}
                        style={{ fontWeight: 600, textAlign: 'left' }}
                      >
                        {m.nome}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>{m.cargo || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="neutral" size="sm" style={{ pointerEvents: 'none' }}>
                      {TIPO_LABEL[m.tipo]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.crm_user_id || !canEditTeam ? (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    ) : pendingByMembroId.has(m.id!) ? (
                      <Badge variant="warning" size="sm">
                        convite pendente
                      </Badge>
                    ) : (
                      <Badge variant="outline" size="sm">
                        sem conta vinculada
                      </Badge>
                    )}
                  </TableCell>
                  {canEditTeam && (
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                      style={{ paddingRight: '0.75rem', textAlign: 'right' }}
                    >
                      <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
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
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={!canEditTeam ? 4 : 5}
                    style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}
                  >
                    Nenhum membro encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogs}
    </div>
  );
}
