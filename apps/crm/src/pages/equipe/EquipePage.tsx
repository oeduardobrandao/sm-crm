import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, Search } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  getMembros, addMembro, updateMembro, removeMembro,
  getWorkspaceUsers, setMembroCrmUser,
  formatBRL, getInitials,
  type Membro,
} from '../../store';
import { useAuth } from '../../context/AuthContext';

type FilterTipo = 'todos' | 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
type SortKey = 'nome' | 'custo_maior' | 'custo_menor';

const membroSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  cargo: z.string().min(1, 'Cargo obrigatório'),
  tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
  custo: z.string(),
  diaPag: z.string().refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
  crmUserId: z.string().optional(),
});
type MembroFormValues = z.infer<typeof membroSchema>;

const AVATAR_COLORS = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT', freelancer_mensal: 'Freelancer Mensal', freelancer_demanda: 'Freelancer Demanda',
};

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function EquipePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAgent = role === 'agent';

  const [filter, setFilter] = useState<FilterTipo>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('nome');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Membro | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { nome: '', cargo: '', tipo: 'clt', custo: '', diaPag: '', crmUserId: '' },
  });

  const { data: membros = [], isLoading } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
    enabled: !isAgent,
  });
  const totalCost = membros.reduce((s, m) => s + (m.custo_mensal ?? 0), 0);

  const filtered = membros
    .filter(m => filter === 'todos' || m.tipo === filter)
    .filter(m => !search || m.nome.toLowerCase().includes(search.toLowerCase()) || m.cargo?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'nome') return a.nome.localeCompare(b.nome);
      if (sort === 'custo_maior') return (b.custo_mensal ?? 0) - (a.custo_mensal ?? 0);
      return (a.custo_mensal ?? 0) - (b.custo_mensal ?? 0);
    });

  const openAdd = () => {
    setEditing(null);
    form.reset({ nome: '', cargo: '', tipo: 'clt', custo: '', diaPag: '', crmUserId: '' });
    setModalOpen(true);
  };

  const openEdit = (m: Membro) => {
    setEditing(m);
    form.reset({
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
      if (editing?.id) {
        const desiredCrmUser = values.crmUserId === '' || values.crmUserId == null ? null : values.crmUserId;
        const currentCrmUser = editing.crm_user_id ?? null;
        if (desiredCrmUser !== currentCrmUser) {
          await setMembroCrmUser(editing.id, desiredCrmUser);
        }
        await updateMembro(editing.id, payload);
        toast.success('Membro atualizado');
      } else {
        await addMembro(payload);
        toast.success('Membro adicionado');
      }
      qc.invalidateQueries({ queryKey: ['membros'] });
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
        let count = 0;
        for (const row of rows) {
          if (!row.nome || !row.cargo) continue;
          try {
            const tipo = (['clt', 'freelancer_mensal', 'freelancer_demanda'].includes(row.tipo) ? row.tipo : 'clt') as Membro['tipo'];
            await addMembro({
              nome: row.nome,
              cargo: row.cargo,
              tipo,
              custo_mensal: row.custo_mensal ? Number(row.custo_mensal) : null,
              avatar_url: '',
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} membro${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['membros'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Equipe</h1>
          <span data-tooltip="Gerencie os membros da equipe e seus custos." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          {!isAgent && (
            <span data-tooltip="Colunas: nome*, cargo*, tipo (clt|freelancer_mensal|freelancer_demanda), custo_mensal, data_pagamento" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
              <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
            </span>
          )}
          {!isAgent && (
            <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV</Button>
          )}
          {!isAgent && (
            <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Adicionar Membro</Button>
          )}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-label">Total de Membros</div>
          <div className="kpi-value">{membros.length}</div>
        </div>
        {!isAgent && (
          <div className="kpi-card">
            <div className="kpi-label">Custo Mensal Total</div>
            <div className="kpi-value">{formatBRL(totalCost)}</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input placeholder="Buscar por nome ou cargo..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
              {filter === 'todos' ? 'Tipo' : TIPO_LABEL[filter]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterTipo)}>
              {(['todos', 'clt', 'freelancer_mensal', 'freelancer_demanda'] as FilterTipo[]).map(f => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {f === 'todos' ? 'Todos' : TIPO_LABEL[f]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nome">Nome</SelectItem>
            {!isAgent && <>
              <SelectItem value="custo_maior">Custo (maior)</SelectItem>
              <SelectItem value="custo_menor">Custo (menor)</SelectItem>
            </>}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <div className="team-grid">
          {filtered.map(m => {
            const color = getAvatarColor(m.nome);
            return (
              <div key={m.id} className="team-card card animate-up" style={{ padding: '1.25rem 1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div className="avatar" style={{ background: color, color: '#fff', fontWeight: 700, width: 44, height: 44, fontSize: '1rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {getInitials(m.nome)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: 0 }}>
                    <button className="client-link" onClick={() => navigate(`/equipe/${m.id}`)} style={{ fontWeight: 600, textAlign: 'left', lineHeight: 1.2 }}>
                      {m.nome}
                    </button>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>{m.cargo}</div>
                    <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                      <Badge variant="secondary" style={{ fontSize: '0.65rem', padding: '0 0.4rem', pointerEvents: 'none' }}>{TIPO_LABEL[m.tipo]}</Badge>
                      {!isAgent && !m.crm_user_id && (
                        <Badge variant="outline" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          sem conta vinculada
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1" style={{ marginLeft: 'auto' }}>
                    {!isAgent && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(m)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {m.id && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(m.id!)}>
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
              <FormField control={form.control} name="nome" render={({ field }) => (
                <FormItem><FormLabel>Nome *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="cargo" render={({ field }) => (
                <FormItem><FormLabel>Cargo *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="tipo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="clt">CLT</SelectItem>
                      <SelectItem value="freelancer_mensal">Freelancer Mensal</SelectItem>
                      <SelectItem value="freelancer_demanda">Freelancer Demanda</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="custo" render={({ field }) => (
                <FormItem><FormLabel>Custo Mensal (R$)</FormLabel><FormControl><Input type="number" min={0} step={0.01} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="diaPag" render={({ field }) => (
                <FormItem><FormLabel>Dia de Pagamento (1-31)</FormLabel><FormControl><Input type="number" min={1} max={31} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {!isAgent && (
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner size="sm" />} Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover este membro?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
