import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getMembros, getTransacoes, formatBRL, formatDate, getInitials,
  updateMembro,
  type Membro,
} from '../../store';
import { useAuth } from '../../context/AuthContext';

const AVATAR_COLORS = ['#eab308','#3ecf8e','#f5a342','#f542c8','#42c8f5','#8b5cf6','#ef4444','#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT', freelancer_mensal: 'Freelancer Mensal', freelancer_demanda: 'Freelancer Demanda',
};

export default function MembroDetalhePage() {
  const { role } = useAuth();
  const isAgent = role === 'agent';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fNome, setFNome] = useState('');
  const [fCargo, setFCargo] = useState('');
  const [fTipo, setFTipo] = useState<Membro['tipo']>('clt');
  const [fCusto, setFCusto] = useState('');
  const [fDiaPag, setFDiaPag] = useState('');

  const { data: membros = [], isLoading: loadingMembros } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: transacoes = [], isLoading: loadingTx } = useQuery({ queryKey: ['transacoes'], queryFn: getTransacoes });

  const membro = membros.find(m => m.id?.toString() === id);

  if (!loadingMembros && !membro) {
    return (
      <div style={{ padding: '2rem' }}>
        <Button variant="outline" onClick={() => navigate('/equipe')}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
        <p style={{ marginTop: 16 }}>Membro não encontrado.</p>
      </div>
    );
  }

  const membroTx = transacoes.filter(t =>
    (membro && t.descricao?.includes(membro.nome)) ||
    t.referencia_agendamento?.includes(`membro_${id}`)
  );
  const totalPago = membroTx.filter(t => t.status === 'pago').reduce((s, t) => s + t.valor, 0);
  const pendente = membroTx.filter(t => t.status === 'agendado').reduce((s, t) => s + t.valor, 0);

  const openEdit = () => {
    if (!membro) return;
    setFNome(membro.nome); setFCargo(membro.cargo || ''); setFTipo(membro.tipo);
    setFCusto(membro.custo_mensal ? String(membro.custo_mensal) : '');
    setFDiaPag(membro.data_pagamento ? String(membro.data_pagamento) : '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMembro(Number(id), {
        nome: fNome, cargo: fCargo, tipo: fTipo,
        custo_mensal: fCusto ? Number(fCusto) : null,
        data_pagamento: fDiaPag ? Number(fDiaPag) : undefined,
      } as Partial<Omit<Membro, 'id' | 'user_id' | 'conta_id'>>);
      toast.success('Membro atualizado');
      qc.invalidateQueries({ queryKey: ['membros'] });
      setModalOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const color = membro ? getAvatarColor(membro.nome) : '#ccc';

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <Button variant="outline" onClick={() => navigate('/equipe')}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
        {!isAgent && (
          <div className="header-actions">
            <Button variant="outline" onClick={openEdit}><Edit2 className="h-4 w-4" /> Editar</Button>
          </div>
        )}
      </div>

      {(loadingMembros || loadingTx) && (
        <div className="flex justify-center p-8"><Spinner size="lg" /></div>
      )}

      {membro && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '1.5rem 0' }}>
            <div className="avatar" style={{ background: color, color: '#fff', fontWeight: 700, width: 56, height: 56, fontSize: 22 }}>
              {getInitials(membro.nome)}
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{membro.nome}</h2>
              <div style={{ color: '#888' }}>{membro.cargo}</div>
            </div>
          </div>

          {!isAgent && (
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
              {[
                { label: 'Custo Mensal', value: formatBRL(membro.custo_mensal ?? 0) },
                { label: 'Total Pago', value: formatBRL(totalPago) },
                { label: 'Pendente', value: formatBRL(pendente) },
              ].map(k => (
                <div key={k.label} className="kpi-card">
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value">{k.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: 12 }}>Informações</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><strong>Cargo:</strong> {membro.cargo}</div>
              <div><strong>Tipo:</strong> {TIPO_LABEL[membro.tipo]}</div>
              {!isAgent && <div><strong>Dia de Pagamento:</strong> {membro.data_pagamento ?? '—'}</div>}
              {!isAgent && <div><strong>Custo Mensal:</strong> {formatBRL(membro.custo_mensal ?? 0)}</div>}
            </div>
          </div>

          {!isAgent && (
            <>
              <h3 style={{ marginBottom: 12 }}>Transações</h3>
              <div className="card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {membroTx.map((t, i) => (
                      <TableRow key={t.id ?? `tx-${i}`}>
                        <TableCell data-label="Data">{formatDate(t.data)}</TableCell>
                        <TableCell data-label="Descrição">{t.descricao}</TableCell>
                        <TableCell data-label="Categoria">{t.categoria}</TableCell>
                        <TableCell data-label="Valor">{formatBRL(t.valor)}</TableCell>
                        <TableCell data-label="Status">{t.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Membro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1"><Label>Nome *</Label><Input value={fNome} onChange={e => setFNome(e.target.value)} /></div>
            <div className="space-y-1"><Label>Cargo *</Label><Input value={fCargo} onChange={e => setFCargo(e.target.value)} /></div>
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
            <div className="space-y-1"><Label>Custo Mensal (R$)</Label><Input type="number" min={0} step={0.01} value={fCusto} onChange={e => setFCusto(e.target.value)} /></div>
            <div className="space-y-1"><Label>Dia de Pagamento (1-31)</Label><Input type="number" min={1} max={31} value={fDiaPag} onChange={e => setFDiaPag(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
