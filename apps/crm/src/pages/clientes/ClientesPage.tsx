import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, Search, ArrowUpDown } from 'lucide-react';
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
  getClientes, addCliente, updateCliente, removeCliente,
  getInitials,
  type Cliente,
} from '../../store';
import { sanitizeUrl } from '../../utils/security';
import { supabase } from '../../lib/supabase';

const clienteSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  email: z.string().email('E-mail inválido').or(z.literal('')),
  telefone: z.string(),
  plano: z.string(),
  valor: z.string(),
  notion: z.string(),
  diaPag: z
    .string()
    .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
  status: z.enum(['ativo', 'pausado', 'encerrado']),
});
type ClienteFormValues = z.infer<typeof clienteSchema>;

type FilterStatus = 'todos' | 'ativo' | 'pausado' | 'encerrado';
const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado' };
const AVATAR_COLORS = ['#e74c3c', '#8e44ad', '#27ae60', '#2980b9', '#d35400', '#16a085'];

async function fetchAvatars(clientIds: number[]): Promise<Record<number, string>> {
  if (!clientIds.length) return {};
  const { data } = await supabase.from('instagram_accounts').select('client_id, profile_picture_url').in('client_id', clientIds).not('profile_picture_url', 'is', null);
  const map: Record<number, string> = {};
  if (data) for (const row of data) if (row.client_id && row.profile_picture_url) map[row.client_id] = row.profile_picture_url;
  return map;
}

export default function ClientesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'nome' | 'valor_mensal' | 'data_pagamento'>('nome');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      nome: '', email: '', telefone: '', plano: '', valor: '', notion: '', diaPag: '', status: 'ativo',
    },
  });

  const { data: clientes = [], isLoading } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: avatarMap = {} } = useQuery({
    queryKey: ['instagram_avatars', clientes.map(c => c.id).join(',')],
    queryFn: () => fetchAvatars(clientes.map(c => c.id as number).filter(Boolean)),
    enabled: clientes.length > 0,
  });

  const filtered = clientes
    .filter(c => filter === 'todos' || c.status === filter)
    .filter(c => !search || c.nome.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'nome') cmp = a.nome.localeCompare(b.nome);
      else if (sortBy === 'valor_mensal') cmp = (a.valor_mensal || 0) - (b.valor_mensal || 0);
      else if (sortBy === 'data_pagamento') cmp = (a.data_pagamento || 0) - (b.data_pagamento || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const openAdd = () => {
    setEditing(null);
    form.reset({
      nome: '', email: '', telefone: '', plano: '', valor: '', notion: '', diaPag: '', status: 'ativo',
    });
    setModalOpen(true);
  };

  const openEdit = (c: Cliente) => {
    setEditing(c);
    form.reset({
      nome: c.nome,
      email: c.email || '',
      telefone: c.telefone || '',
      plano: c.plano || '',
      valor: c.valor_mensal ? String(c.valor_mensal) : '',
      notion: c.notion_page_url || '',
      diaPag: c.data_pagamento ? String(c.data_pagamento) : '',
      status: c.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ClienteFormValues) => {
    const diaPag = values.diaPag ? parseInt(values.diaPag, 10) : undefined;
    setSaving(true);
    try {
      if (editing?.id) {
        await updateCliente(editing.id, {
          nome: values.nome, email: values.email, telefone: values.telefone, plano: values.plano,
          valor_mensal: values.valor ? Number(values.valor) : 0, notion_page_url: values.notion,
          data_pagamento: diaPag, status: values.status,
        });
        toast.success('Cliente atualizado');
      } else {
        const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        await addCliente({
          nome: values.nome, email: values.email, telefone: values.telefone, plano: values.plano,
          valor_mensal: values.valor ? Number(values.valor) : 0, notion_page_url: values.notion,
          data_pagamento: diaPag,
          sigla: getInitials(values.nome), cor: randomColor, status: 'ativo',
        });
        toast.success('Cliente adicionado');
      }
      qc.invalidateQueries({ queryKey: ['clientes'] });
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
      await removeCliente(deleteId);
      toast.success('Cliente removido');
      qc.invalidateQueries({ queryKey: ['clientes'] });
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
          if (!row.nome) continue;
          try {
            const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
            await addCliente({
              nome: row.nome,
              email: row.email || '',
              telefone: row.telefone || '',
              plano: row.plano || '',
              valor_mensal: row.valor_mensal ? Number(row.valor_mensal) : 0,
              notion_page_url: row.notion_page_url || '',
              data_pagamento: row.data_pagamento ? Number(row.data_pagamento) : undefined,
              sigla: getInitials(row.nome),
              cor: randomColor,
              status: 'ativo',
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} cliente${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['clientes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Clientes</h1>
          <span data-tooltip="Gerencie todos os clientes e contratos ativos." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip="Colunas: nome*, email, telefone, plano, valor_mensal, notion_page_url, data_pagamento" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Cliente</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
              {filter === 'todos' ? 'Status' : STATUS_LABEL[filter]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
              {(['todos', 'ativo', 'pausado', 'encerrado'] as FilterStatus[]).map(f => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[160px]">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nome">Nome</SelectItem>
            <SelectItem value="valor_mensal">Valor Mensal</SelectItem>
            <SelectItem value="data_pagamento">Dia Pagamento</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}>
          <ArrowUpDown className="h-4 w-4" style={{ transform: sortDir === 'desc' ? 'scaleY(-1)' : undefined }} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <div className="team-grid">
          {filtered.map(c => {
            const avatarUrl = c.id ? avatarMap[c.id] : undefined;
            const initials = getInitials(c.nome);
            return (
              <div key={c.id ?? c.nome} className="team-card card animate-up" style={{ padding: '1.25rem 1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={initials} className="avatar" style={{ width: 44, height: 44, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div className="avatar" style={{ background: c.cor, color: '#fff', fontWeight: 700, width: 44, height: 44, fontSize: '1rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button className="client-link" onClick={() => navigate(`/clientes/${c.id}`)} style={{ fontWeight: 600, textAlign: 'left', lineHeight: 1.2 }}>
                        {c.nome}
                      </button>
                      <Badge variant={c.status === 'ativo' ? 'default' : c.status === 'pausado' ? 'secondary' : 'outline'} style={{ fontSize: '0.65rem', padding: '0 0.4rem', pointerEvents: 'none' }}>
                        {STATUS_LABEL[c.status]}
                      </Badge>
                      {c.notion_page_url && sanitizeUrl(c.notion_page_url) && (
                        <a href={sanitizeUrl(c.notion_page_url)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }} title="Abrir no Notion">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M4.459 4.208c.745-.303 1.25-.333 2.162-.333h13.26c.925 0 1.542.13 2.122.333l-2.003-2.189H4.153L2.164 4.208zm11.233 1.89-6.903.015L3.305 24h10.96l5.77-5.908-.008-5.32c-.006-2.133-1.077-4.137-3.08-5.419-1.258-.806-2.92-1.229-4.707-1.397L15.692 6.1zm-3.02 5.068-1.503 1.564v9.066H9.155v-8.87l-.022-1.63L12.67 11.168zm2.75-.15.42 2.973L13.88 15.645l.951-1.31-2.163.023.23-1.428-1.748-1.71h4.272z" />
                          </svg>
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888', display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.plano && <span>{c.plano}</span>}
                      {c.plano && c.email && <span>&bull;</span>}
                      {c.email && <span>{c.email}</span>}
                      {c.email && c.telefone && <span>&bull;</span>}
                      {c.telefone && <span>{c.telefone}</span>}
                    </div>
                  </div>

                  <div className="flex gap-1" style={{ marginLeft: 'auto' }}>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    {c.id && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDeleteId(c.id!)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
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
            <DialogTitle>{editing ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField control={form.control} name="nome" render={({ field }) => (
                <FormItem><FormLabel>Nome *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>E-mail</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="telefone" render={({ field }) => (
                <FormItem><FormLabel>Telefone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="plano" render={({ field }) => (
                <FormItem><FormLabel>Plano</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="valor" render={({ field }) => (
                <FormItem><FormLabel>Valor Mensal (R$)</FormLabel><FormControl><Input type="number" min={0} step={0.01} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="notion" render={({ field }) => (
                <FormItem><FormLabel>URL do Notion</FormLabel><FormControl><Input placeholder="https://notion.so/..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="diaPag" render={({ field }) => (
                <FormItem><FormLabel>Dia de Pagamento (1-31)</FormLabel><FormControl><Input type="number" min={1} max={31} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {editing && (
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="pausado">Pausado</SelectItem>
                        <SelectItem value="encerrado">Encerrado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving && <Spinner size="sm" />} Salvar</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover este cliente?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
