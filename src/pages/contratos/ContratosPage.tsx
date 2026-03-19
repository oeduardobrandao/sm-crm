import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Upload, Info, HelpCircle } from 'lucide-react';
import { openCSVSelector } from '../../lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getContratos, addContrato, updateContrato, removeContrato,
  getClientes, formatBRL, formatDate,
  type Contrato,
} from '../../store';

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
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contrato | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [fTitulo, setFTitulo] = useState('');
  const [fClienteId, setFClienteId] = useState('');
  const [fDataInicio, setFDataInicio] = useState('');
  const [fDataFim, setFDataFim] = useState('');
  const [fValor, setFValor] = useState('');
  const [fStatus, setFStatus] = useState('a_assinar');

  const { data: contratos = [], isLoading } = useQuery({ queryKey: ['contratos'], queryFn: getContratos });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const filtered = contratos.filter(c => filter === 'todos' || c.status === filter);

  const openAdd = () => {
    setEditing(null);
    setFTitulo(''); setFClienteId(''); setFDataInicio(''); setFDataFim(''); setFValor(''); setFStatus('a_assinar');
    setModalOpen(true);
  };

  const openEdit = (c: Contrato) => {
    setEditing(c);
    setFTitulo(c.titulo);
    setFClienteId(c.cliente_id ? String(c.cliente_id) : '');
    setFDataInicio(c.data_inicio);
    setFDataFim(c.data_fim);
    setFValor(String(c.valor_total));
    setFStatus(c.status);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!fTitulo || !fDataInicio || !fDataFim || !fValor) return;
    setSaving(true);
    try {
      const clienteId = fClienteId ? Number(fClienteId) : null;
      const clienteSel = clientes.find(c => c.id === clienteId);
      const payload: Omit<Contrato, 'id' | 'user_id' | 'conta_id'> = {
        titulo: fTitulo,
        cliente_id: clienteId,
        cliente_nome: clienteSel?.nome ?? '',
        data_inicio: fDataInicio,
        data_fim: fDataFim,
        valor_total: Number(fValor),
        status: fStatus as Contrato['status'],
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

      <div className="filter-bar" style={{ marginBottom: '1rem' }}>
        {(['todos', 'vigente', 'a_assinar', 'encerrado'] as FilterStatus[]).map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
          </button>
        ))}
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
                  <TableCell>{c.titulo}</TableCell>
                  <TableCell>
                    {c.cliente_id ? (
                      <button className="client-link" onClick={() => navigate(`/clientes/${c.cliente_id}`)}>
                        {c.cliente_nome}
                      </button>
                    ) : (
                      <span>{c.cliente_nome}</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(c.data_inicio)} → {formatDate(c.data_fim)}</TableCell>
                  <TableCell>{formatBRL(c.valor_total)}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'vigente' ? 'default' : c.status === 'a_assinar' ? 'secondary' : 'outline'}>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Contrato' : 'Novo Contrato'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Título</Label>
              <Input value={fTitulo} onChange={e => setFTitulo(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Select value={fClienteId || '__none__'} onValueChange={v => setFClienteId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {clientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Data Início</Label>
                <Input type="date" value={fDataInicio} onChange={e => setFDataInicio(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Data Fim</Label>
                <Input type="date" value={fDataFim} onChange={e => setFDataFim(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Valor Total (R$)</Label>
              <Input type="number" min={0} step={0.01} value={fValor} onChange={e => setFValor(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_assinar">A Assinar</SelectItem>
                  <SelectItem value="vigente">Vigente</SelectItem>
                  <SelectItem value="encerrado">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />} Salvar
            </Button>
          </DialogFooter>
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
