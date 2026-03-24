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
import {
  getMembros, addMembro, updateMembro, removeMembro,
  formatBRL, getInitials,
  type Membro,
} from '../../store';
import { useAuth } from '../../context/AuthContext';

type FilterTipo = 'todos' | 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
type SortKey = 'nome' | 'custo_maior' | 'custo_menor';

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
  const [sort, setSort] = useState<SortKey>('nome');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Membro | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [fNome, setFNome] = useState('');
  const [fCargo, setFCargo] = useState('');
  const [fTipo, setFTipo] = useState<Membro['tipo']>('clt');
  const [fCusto, setFCusto] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');

  const { data: membros = [], isLoading } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const totalCost = membros.reduce((s, m) => s + (m.custo_mensal ?? 0), 0);

  const filtered = membros
    .filter(m => filter === 'todos' || m.tipo === filter)
    .sort((a, b) => {
      if (sort === 'nome') return a.nome.localeCompare(b.nome);
      if (sort === 'custo_maior') return (b.custo_mensal ?? 0) - (a.custo_mensal ?? 0);
      return (a.custo_mensal ?? 0) - (b.custo_mensal ?? 0);
    });

  const openAdd = () => {
    setEditing(null);
    setFNome(''); setFCargo(''); setFTipo('clt'); setFCusto(''); setFDiaPag('');
    setModalOpen(true);
  };

  const openEdit = (m: Membro) => {
    setEditing(m);
    setFNome(m.nome); setFCargo(m.cargo || ''); setFTipo(m.tipo);
    setFCusto(m.custo_mensal ? String(m.custo_mensal) : '');
    setFDiaPag(m.data_pagamento ? String(m.data_pagamento) : '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!fNome || !fCargo) return;
    setSaving(true);
    try {
      const payload: Omit<Membro, 'id' | 'user_id' | 'conta_id'> = {
        nome: fNome, cargo: fCargo, tipo: fTipo,
        custo_mensal: fCusto ? Number(fCusto) : null,
        avatar_url: '',
        data_pagamento: fDiaPag ? Number(fDiaPag) : undefined,
      };
      if (editing?.id) {
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

      <div style={{ display: 'flex', gap: 12, marginBottom: '0.5rem', alignItems: 'start', flexWrap: 'wrap' }}>
        <div className="filter-bar">
          {(['todos', 'clt', 'freelancer_mensal', 'freelancer_demanda'] as FilterTipo[]).map(f => (
            <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'todos' ? 'Todos' : TIPO_LABEL[f]}
            </button>
          ))}
        </div>
        <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
          <SelectTrigger style={{ width: 180 }}><SelectValue /></SelectTrigger>
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
                    <div style={{ marginTop: 2 }}>
                      <Badge variant="secondary" style={{ fontSize: '0.65rem', padding: '0 0.4rem', pointerEvents: 'none' }}>{TIPO_LABEL[m.tipo]}</Badge>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Membro' : 'Adicionar Membro'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={fNome} onChange={e => setFNome(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Cargo *</Label>
              <Input value={fCargo} onChange={e => setFCargo(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={fTipo} onValueChange={v => setFTipo(v as Membro['tipo'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clt">CLT</SelectItem>
                  <SelectItem value="freelancer_mensal">Freelancer Mensal</SelectItem>
                  <SelectItem value="freelancer_demanda">Freelancer Demanda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Custo Mensal (R$)</Label>
              <Input type="number" min={0} step={0.01} value={fCusto} onChange={e => setFCusto(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Dia de Pagamento (1-31)</Label>
              <Input type="number" min={1} max={31} value={fDiaPag} onChange={e => setFDiaPag(e.target.value)} />
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
