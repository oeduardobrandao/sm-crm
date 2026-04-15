import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle, UserPlus } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  getLeads, addLead, updateLead, removeLead, addCliente, getInitials,
  type Lead,
} from '../../store';

const leadSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  email: z.string().email('E-mail inválido').or(z.literal('')),
  instagram: z.string(),
  canal: z.string(),
  especialidade: z.string(),
  faturamento: z.string(),
  tags: z.string(),
  notas: z.string(),
  status: z.enum(['novo', 'contatado', 'qualificado', 'perdido', 'convertido']),
});
type LeadFormValues = z.infer<typeof leadSchema>;

const convertSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  email: z.string().email('E-mail inválido').or(z.literal('')),
  telefone: z.string(),
  plano: z.string(),
  valor: z.string(),
  diaPag: z
    .string()
    .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
});
type ConvertFormValues = z.infer<typeof convertSchema>;

const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado', perdido: 'Perdido', convertido: 'Convertido',
};
const CANAL_OPTIONS = ['Instagram', 'Facebook', 'Google Ads', 'Indicação', 'Site', 'WhatsApp', 'Typeform', 'Outro'];
const FATURAMENTO_OPTIONS = [
  'Até R$ 5.000/mês', 'De R$ 5.000 a R$ 10.000/mês', 'De R$ 10.000 a R$ 20.000/mês',
  'De R$ 20.000 a R$ 50.000/mês', 'Acima de R$ 50.000/mês',
];

type StatusFilter = 'todos' | Lead['status'];
type SortDir = 'asc' | 'desc';

function parseInstagram(raw: string): string {
  if (!raw) return '';
  let val = raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '').replace(/^@/, '');
  return val ? `@${val}` : '';
}

export default function LeadsPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('todos');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [convertSaving, setConvertSaving] = useState(false);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      nome: '', email: '', instagram: '', canal: '', especialidade: '',
      faturamento: '', tags: '', notas: '', status: 'novo',
    },
  });

  const convertForm = useForm<ConvertFormValues>({
    resolver: zodResolver(convertSchema),
    defaultValues: { nome: '', email: '', telefone: '', plano: '', valor: '', diaPag: '' },
  });

  const { data: leads = [], isLoading } = useQuery({ queryKey: ['leads'], queryFn: getLeads });

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  const sortIcon = (col: string) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const filtered = useMemo(() => {
    let list = leads;
    if (filterStatus !== 'todos') list = list.filter(l => l.status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l => [l.nome, l.email, l.instagram, l.especialidade, l.canal, l.tags].some(v => v?.toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortCol] as string ?? '';
      const bv = (b as unknown as Record<string, unknown>)[sortCol] as string ?? '';
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, filterStatus, search, sortCol, sortDir]);

  const openAdd = () => {
    setEditing(null);
    form.reset({
      nome: '', email: '', instagram: '', canal: '', especialidade: '',
      faturamento: '', tags: '', notas: '', status: 'novo',
    });
    setModalOpen(true);
  };

  const openEdit = (l: Lead) => {
    setEditing(l);
    form.reset({
      nome: l.nome,
      email: l.email || '',
      instagram: l.instagram || '',
      canal: l.canal || '',
      especialidade: l.especialidade || '',
      faturamento: l.faturamento || '',
      tags: l.tags || '',
      notas: l.notas || '',
      status: l.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: LeadFormValues) => {
    setSaving(true);
    try {
      const payload: Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'> = {
        nome: values.nome,
        email: values.email,
        telefone: '',
        instagram: parseInstagram(values.instagram),
        canal: values.canal,
        especialidade: values.especialidade,
        faturamento: values.faturamento,
        tags: values.tags,
        notas: values.notas,
        objetivo: '',
        origem: 'manual',
        status: values.status,
      };
      if (editing?.id) {
        await updateLead(editing.id, payload);
        toast.success('Lead atualizado');
      } else {
        await addLead(payload);
        toast.success('Lead criado');
      }
      qc.invalidateQueries({ queryKey: ['leads'] });
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
      await removeLead(deleteId);
      toast.success('Lead removido');
      qc.invalidateQueries({ queryKey: ['leads'] });
    } catch {
      toast.error('Erro ao remover');
    }
    setDeleteId(null);
  };

  const handleStatusChange = async (id: number, status: Lead['status']) => {
    try {
      await updateLead(id, { status });
      qc.invalidateQueries({ queryKey: ['leads'] });
    } catch {
      toast.error('Erro ao atualizar status');
    }
  };

  const AVATAR_COLORS = ['#e74c3c','#8e44ad','#27ae60','#2980b9','#d35400','#16a085'];

  const openConvert = (l: Lead) => {
    setConvertingLead(l);
    convertForm.reset({
      nome: l.nome,
      email: l.email || '',
      telefone: '', plano: '', valor: '', diaPag: '',
    });
    setConvertModalOpen(true);
  };

  const onConvertSubmit = async (values: ConvertFormValues) => {
    if (!convertingLead?.id) return;
    setConvertSaving(true);
    try {
      const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
      await addCliente({
        nome: values.nome,
        email: values.email,
        telefone: values.telefone,
        plano: values.plano,
        valor_mensal: values.valor ? Number(values.valor) : 0,
        notion_page_url: '',
        data_pagamento: values.diaPag ? parseInt(values.diaPag, 10) : undefined,
        sigla: getInitials(values.nome),
        cor: randomColor,
        status: 'ativo',
      });
      await updateLead(convertingLead.id, { status: 'convertido' });
      toast.success('Cliente criado e lead convertido!');
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setConvertModalOpen(false);
    } catch {
      toast.error('Erro ao converter lead');
    } finally {
      setConvertSaving(false);
    }
  };

  const handleCSVImport = () => {
    openCSVSelector(
      async (rows) => {
        let count = 0;
        for (const row of rows) {
          if (!row.nome) continue;
          try {
            await addLead({
              nome: row.nome,
              email: row.email || '',
              telefone: row.telefone || '',
              instagram: parseInstagram(row.instagram || ''),
              canal: row.canal || '',
              especialidade: row.especialidade || '',
              faturamento: row.faturamento || '',
              tags: row.tags || '',
              notas: row.notas || '',
              objetivo: row.objetivo || '',
              origem: 'manual',
              status: (['novo', 'contatado', 'qualificado', 'perdido', 'convertido'].includes(row.status) ? row.status : 'novo') as Lead['status'],
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} lead${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['leads'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Leads</h1>
          <span data-tooltip="Gerencie e acompanhe contatos de potenciais clientes." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip="Colunas: nome*, email, instagram, canal, especialidade, faturamento, tags, notas, status" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Lead</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
              {filterStatus === 'todos' ? 'Status' : STATUS_LABELS[filterStatus]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuRadioGroup value={filterStatus} onValueChange={(v) => setFilterStatus(v as StatusFilter)}>
              {(['todos', 'novo', 'contatado', 'qualificado', 'perdido', 'convertido'] as StatusFilter[]).map(f => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {f === 'todos' ? 'Todos' : STATUS_LABELS[f]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-56"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <div className="card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('nome')}>Nome{sortIcon('nome')}</TableHead>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('email')}>E-mail{sortIcon('email')}</TableHead>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('canal')}>Canal{sortIcon('canal')}</TableHead>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('especialidade')}>Especialidade{sortIcon('especialidade')}</TableHead>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }}>Status</TableHead>
                <TableHead style={{ cursor: 'pointer', fontWeight: '800' }} onClick={() => handleSort('created_at')}>Criado{sortIcon('created_at')}</TableHead>
                <TableHead style={{ fontWeight: '800' }}>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(l => (
                <TableRow key={l.id ?? l.nome}>
                  <TableCell data-label="Nome">
                    <div>{l.nome}</div>
                    {l.instagram && <div style={{ fontSize: 12, color: '#888' }}>{l.instagram}</div>}
                  </TableCell>
                  <TableCell data-label="E-mail">{l.email}</TableCell>
                  <TableCell data-label="Canal">{l.canal}</TableCell>
                  <TableCell data-label="Especialidade">{l.especialidade}</TableCell>
                  <TableCell data-label="Status">
                    <Select value={l.status} onValueChange={val => l.id && handleStatusChange(l.id, val as Lead['status'])}>
                      <SelectTrigger style={{ width: 140 }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell data-label="Criado">{l.created_at ? new Date(l.created_at).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                      <Button size="icon" variant="ghost" title="Converter em cliente" onClick={() => openConvert(l)}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(l)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {l.id && (
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(l.id!)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Lead' : 'Novo Lead'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="instagram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram</FormLabel>
                    <FormControl><Input placeholder="@usuario ou URL" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="canal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CANAL_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="especialidade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Especialidade</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="faturamento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Faturamento</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FATURAMENTO_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl><Input placeholder="tag1, tag2, ..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl><Textarea rows={3} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {editing && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
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

      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent onConfirmClose={() => setConvertModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Converter Lead em Cliente</DialogTitle>
          </DialogHeader>
          <Form {...convertForm}>
            <form onSubmit={convertForm.handleSubmit(onConvertSubmit)} className="space-y-3">
              <FormField
                control={convertForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="telefone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="plano"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="valor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Valor Mensal (R$)</FormLabel>
                    <FormControl><Input type="number" min={0} step={0.01} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={convertForm.control}
                name="diaPag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dia de Pagamento (1-31)</FormLabel>
                    <FormControl><Input type="number" min={1} max={31} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConvertModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={convertSaving}>
                  {convertSaving && <Spinner size="sm" />} Criar Cliente
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover este lead?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
