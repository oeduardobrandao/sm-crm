import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  getLeads, addLead, updateLead, removeLead,
  type Lead,
} from '../../store';

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

  const [fNome, setFNome] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fInstagram, setFInstagram] = useState('');
  const [fCanal, setFCanal] = useState('');
  const [fEspecialidade, setFEspecialidade] = useState('');
  const [fFaturamento, setFFaturamento] = useState('');
  const [fTags, setFTags] = useState('');
  const [fObs, setFObs] = useState('');
  const [fStatus, setFStatus] = useState<Lead['status']>('novo');

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
    setFNome(''); setFEmail(''); setFInstagram(''); setFCanal(''); setFEspecialidade('');
    setFFaturamento(''); setFTags(''); setFObs(''); setFStatus('novo');
    setModalOpen(true);
  };

  const openEdit = (l: Lead) => {
    setEditing(l);
    setFNome(l.nome); setFEmail(l.email || ''); setFInstagram(l.instagram || ''); setFCanal(l.canal || '');
    setFEspecialidade(l.especialidade || ''); setFFaturamento(l.faturamento || ''); setFTags(l.tags || '');
    setFObs(l.notas || ''); setFStatus(l.status);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!fNome) return;
    setSaving(true);
    try {
      const payload: Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'> = {
        nome: fNome, email: fEmail, telefone: '',
        instagram: parseInstagram(fInstagram),
        canal: fCanal, especialidade: fEspecialidade, faturamento: fFaturamento,
        tags: fTags, notas: fObs, objetivo: '', origem: 'manual', status: fStatus,
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

      <div style={{ display: 'flex', gap: 12, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="filter-bar" style={{ margin: 0 }}>
          {(['todos', 'novo', 'contatado', 'qualificado', 'perdido', 'convertido'] as StatusFilter[]).map(f => (
            <button key={f} className={`filter-btn${filterStatus === f ? ' active' : ''}`} onClick={() => setFilterStatus(f)}>
              {f === 'todos' ? 'Todos' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 220 }}
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
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={fNome} onChange={e => setFNome(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>E-mail</Label>
              <Input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Instagram</Label>
              <Input placeholder="@usuario ou URL" value={fInstagram} onChange={e => setFInstagram(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Canal</Label>
              <Select value={fCanal} onValueChange={setFCanal}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {CANAL_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Especialidade</Label>
              <Input value={fEspecialidade} onChange={e => setFEspecialidade(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Faturamento</Label>
              <Select value={fFaturamento} onValueChange={setFFaturamento}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {FATURAMENTO_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tags</Label>
              <Input placeholder="tag1, tag2, ..." value={fTags} onChange={e => setFTags(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <textarea className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" rows={3} value={fObs} onChange={e => setFObs(e.target.value)} />
            </div>
            {editing && (
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={fStatus} onValueChange={v => setFStatus(v as Lead['status'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
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
