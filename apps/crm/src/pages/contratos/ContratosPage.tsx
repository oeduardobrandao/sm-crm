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
import { DatePicker } from '@/components/ui/date-picker';
import {
  getContratos, addContrato, updateContrato, removeContrato,
  getClientes, formatBRL, formatDate,
  type Contrato,
} from '../../store';

const contratoSchema = z.object({
  titulo: z.string().min(1, 'Título obrigatório'),
  clienteId: z.string(),
  dataInicio: z.string().min(1, 'Data início obrigatória'),
  dataFim: z.string().min(1, 'Data fim obrigatória'),
  valor: z.string().min(1, 'Valor obrigatório').refine((v) => Number(v) > 0, 'Valor deve ser positivo'),
  status: z.enum(['a_assinar', 'vigente', 'encerrado']),
});
type ContratoFormValues = z.infer<typeof contratoSchema>;

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type FilterStatus = 'todos' | 'vigente' | 'a_assinar' | 'encerrado';

const STATUS_LABEL: Record<string, string> = {
  vigente: 'Vigente',
  a_assinar: 'A Assinar',
  encerrado: 'Encerrado',
};

export default function ContratosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contrato | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ContratoFormValues>({
    resolver: zodResolver(contratoSchema),
    defaultValues: {
      titulo: '', clienteId: '', dataInicio: '', dataFim: '', valor: '', status: 'a_assinar',
    },
  });

  const { data: contratos = [], isLoading } = useQuery({ queryKey: ['contratos'], queryFn: getContratos });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const filtered = contratos
    .filter(c => filter === 'todos' || c.status === filter)
    .filter(c => !search || c.titulo.toLowerCase().includes(search.toLowerCase()) || c.cliente_nome?.toLowerCase().includes(search.toLowerCase()));

  const openAdd = () => {
    setEditing(null);
    form.reset({ titulo: '', clienteId: '', dataInicio: '', dataFim: '', valor: '', status: 'a_assinar' });
    setModalOpen(true);
  };

  const openEdit = (c: Contrato) => {
    setEditing(c);
    form.reset({
      titulo: c.titulo,
      clienteId: c.cliente_id ? String(c.cliente_id) : '',
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      valor: String(c.valor_total),
      status: c.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: ContratoFormValues) => {
    setSaving(true);
    try {
      const clienteId = values.clienteId ? Number(values.clienteId) : null;
      const clienteSel = clientes.find(c => c.id === clienteId);
      const payload: Omit<Contrato, 'id' | 'user_id' | 'conta_id'> = {
        titulo: values.titulo,
        cliente_id: clienteId,
        cliente_nome: clienteSel?.nome ?? '',
        data_inicio: values.dataInicio,
        data_fim: values.dataFim,
        valor_total: Number(values.valor),
        status: values.status,
      };
      if (editing?.id) {
        await updateContrato(editing.id, payload);
        toast.success('Contrato atualizado');
      } else {
        await addContrato(payload);
        toast.success('Contrato criado');
      }
      qc.invalidateQueries({ queryKey: ['contratos'] });
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
      await removeContrato(deleteId);
      toast.success('Contrato removido');
      qc.invalidateQueries({ queryKey: ['contratos'] });
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
          if (!row.titulo || !row.data_inicio || !row.data_fim || !row.valor_total) continue;
          try {
            const clienteMatch = row.cliente_nome ? clientes.find(c => c.nome.toLowerCase() === row.cliente_nome.toLowerCase()) : null;
            const status = (['vigente','a_assinar','encerrado'].includes(row.status) ? row.status : 'a_assinar') as Contrato['status'];
            await addContrato({
              titulo: row.titulo,
              cliente_id: clienteMatch?.id ?? null,
              cliente_nome: row.cliente_nome || '',
              data_inicio: row.data_inicio,
              data_fim: row.data_fim,
              valor_total: Number(row.valor_total),
              status,
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} contrato${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['contratos'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Contratos</h1>
          <span data-tooltip="Gerencie os contratos dos seus clientes." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip="Colunas: titulo*, cliente_nome, data_inicio* (AAAA-MM-DD), data_fim*, valor_total*, status" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}><Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Contrato</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
          <Search className="h-4 w-4" style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <Input placeholder="Buscar por título ou cliente..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '2rem' }} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
              {filter === 'todos' ? 'Status' : STATUS_LABEL[filter]}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
              {(['todos', 'vigente', 'a_assinar', 'encerrado'] as FilterStatus[]).map(f => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      ) : (
        <div className="card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(c => (
                <TableRow key={c.id ?? c.titulo}>
                  <TableCell data-label="Contrato">{c.titulo}</TableCell>
                  <TableCell data-label="Cliente">
                    {c.cliente_id ? (
                      <button className="client-link" onClick={() => navigate(`/clientes/${c.cliente_id}`)}>
                        {c.cliente_nome}
                      </button>
                    ) : (
                      <span>{c.cliente_nome}</span>
                    )}
                  </TableCell>
                  <TableCell data-label="Período">{formatDate(c.data_inicio)} → {formatDate(c.data_fim)}</TableCell>
                  <TableCell data-label="Valor">{formatBRL(c.valor_total)}</TableCell>
                  <TableCell data-label="Status">
                    <Badge variant={c.status === 'vigente' ? 'default' : c.status === 'a_assinar' ? 'secondary' : 'outline'}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {c.id && (
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(c.id!)}>
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
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Contrato' : 'Novo Contrato'}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="titulo" render={({ field }) => (
                <FormItem><FormLabel>Título</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="clienteId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <Select
                    value={field.value || '__none__'}
                    onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                  >
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
                      {clientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="dataInicio" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data Início</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={isoToDate(field.value)}
                        onChange={(d) => field.onChange(d ? dateToIso(d) : '')}
                        className="w-full"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dataFim" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data Fim</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={isoToDate(field.value)}
                        onChange={(d) => field.onChange(d ? dateToIso(d) : '')}
                        className="w-full"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="valor" render={({ field }) => (
                <FormItem><FormLabel>Valor Total (R$)</FormLabel><FormControl><Input type="number" min={0} step={0.01} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="a_assinar">A Assinar</SelectItem>
                      <SelectItem value="vigente">Vigente</SelectItem>
                      <SelectItem value="encerrado">Encerrado</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
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
          <AlertDialogHeader><AlertDialogTitle>Remover este contrato?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
