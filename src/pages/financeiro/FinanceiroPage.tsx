import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, Check, Upload, Info, HelpCircle } from 'lucide-react';
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
  getClientes, getMembros, getTransacoes, projetarAgendamentos,
  addTransacao, updateTransacao, removeTransacao,
  formatBRL, formatDate,
  type Transacao,
} from '../../store';

const CATEGORIAS = ['Mensalidade', 'Produção', 'Tráfego', 'Salário', 'Imposto', 'Ferramenta', 'Outro'];
type FilterType = 'todas' | 'entradas' | 'saidas';

export default function FinanceiroPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('todas');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<'entrada' | 'saida'>('entrada');
  const [editing, setEditing] = useState<Transacao | null>(null);
  const [confirmT, setConfirmT] = useState<Transacao | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // form state
  const [fDescricao, setFDescricao] = useState('');
  const [fValor, setFValor] = useState('');
  const [fData, setFData] = useState('');
  const [fCategoria, setFCategoria] = useState('');

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: transacoesFisicas = [], isLoading } = useQuery({ queryKey: ['transacoes'], queryFn: getTransacoes });

  const allTransacoes = projetarAgendamentos(transacoesFisicas, clientes, membros);
  const recebido = allTransacoes.filter(t => t.tipo === 'entrada' && t.status === 'pago').reduce((s, t) => s + t.valor, 0);
  const aReceber = allTransacoes.filter(t => t.tipo === 'entrada' && t.status === 'agendado').reduce((s, t) => s + t.valor, 0);
  const aPagar = allTransacoes.filter(t => t.tipo === 'saida' && t.status === 'agendado').reduce((s, t) => s + t.valor, 0);
  const saldoAtual = recebido - allTransacoes.filter(t => t.tipo === 'saida' && t.status === 'pago').reduce((s, t) => s + t.valor, 0);
  const saldoProjetado = saldoAtual + aReceber - aPagar;

  const filtered = allTransacoes.filter(t => {
    if (filter === 'entradas') return t.tipo === 'entrada';
    if (filter === 'saidas') return t.tipo === 'saida';
    return true;
  });

  const openAdd = (tipo: 'entrada' | 'saida') => {
    setEditing(null);
    setModalTipo(tipo);
    setFDescricao(''); setFValor(''); setFData(''); setFCategoria('');
    setModalOpen(true);
  };

  const openEdit = (t: Transacao) => {
    setEditing(t);
    setModalTipo(t.tipo);
    setFDescricao(t.descricao);
    setFValor(String(t.valor));
    setFData(t.data);
    setFCategoria(t.categoria || '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!fDescricao || !fValor || !fData) return;
    setSaving(true);
    try {
      const payload: Omit<Transacao, 'id' | 'user_id' | 'conta_id'> = {
        descricao: fDescricao,
        detalhe: '',
        valor: Number(fValor),
        data: fData,
        categoria: fCategoria,
        tipo: modalTipo,
        status: 'pago',
      };
      if (editing?.id) {
        await updateTransacao(editing.id, payload);
        toast.success('Transação atualizada');
      } else {
        await addTransacao(payload);
        toast.success('Transação registrada');
      }
      qc.invalidateQueries({ queryKey: ['transacoes'] });
      setModalOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmPago = async () => {
    if (!confirmT) return;
    try {
      if (confirmT.id && !confirmT.referencia_agendamento) {
        await updateTransacao(confirmT.id, { status: 'pago' });
      } else {
        const { id, user_id, conta_id, ...rest } = confirmT;
        await addTransacao({ ...rest, status: 'pago' });
      }
      toast.success('Pagamento confirmado');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
    } catch {
      toast.error('Erro ao confirmar pagamento');
    }
    setConfirmT(null);
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await removeTransacao(deleteId);
      toast.success('Transação removida');
      qc.invalidateQueries({ queryKey: ['transacoes'] });
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
          if (!row.descricao || !row.valor || !row.data) continue;
          try {
            const tipo = (row.tipo === 'saida' ? 'saida' : 'entrada') as Transacao['tipo'];
            await addTransacao({
              descricao: row.descricao,
              detalhe: row.detalhe || '',
              valor: Number(row.valor),
              data: row.data,
              categoria: row.categoria || '',
              tipo,
              status: 'pago',
            });
            count++;
          } catch { /* skip row */ }
        }
        toast.success(`${count} transação${count !== 1 ? 'ões' : ''} importada${count !== 1 ? 's' : ''} com sucesso!`);
        qc.invalidateQueries({ queryKey: ['transacoes'] });
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h1>Financeiro</h1>
          <span data-tooltip="Visão das finanças, receitas projetadas e despesas." data-tooltip-dir="right" style={{ display: 'flex' }}>
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="header-actions">
          <span data-tooltip="Colunas: descricao*, valor*, data* (AAAA-MM-DD), tipo (entrada|saida), categoria, detalhe" data-tooltip-dir="bottom" style={{ display: 'flex' }}>
            <HelpCircle className="h-4 w-4" style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
          </span>
          <Button variant="outline" onClick={handleCSVImport}>
            <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Importar CSV
          </Button>
          <Button onClick={() => openAdd('entrada')}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Registrar Entrada
          </Button>
          <Button variant="outline" onClick={() => openAdd('saida')}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Registrar Saída
          </Button>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'Recebido', value: formatBRL(recebido), color: '#3ecf8e' },
          { label: 'A Receber', value: formatBRL(aReceber), color: '#f5a342' },
          { label: 'A Pagar', value: formatBRL(aPagar), color: '#ef4444' },
          { label: 'Saldo Atual', value: formatBRL(saldoAtual), color: saldoAtual >= 0 ? '#3ecf8e' : '#ef4444' },
          { label: 'Saldo Projetado', value: formatBRL(saldoProjetado), color: saldoProjetado >= 0 ? '#3ecf8e' : '#ef4444' },
        ].map(kpi => (
          <div key={kpi.label} className="kpi-card">
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="filter-bar" style={{ marginBottom: '1rem' }}>
        {(['todas', 'entradas', 'saidas'] as FilterType[]).map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
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
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t, i) => (
                <TableRow key={t.id ?? `proj-${i}`}>
                  <TableCell data-label="Data">{formatDate(t.data)}</TableCell>
                  <TableCell data-label="Descrição">
                    <div>{t.descricao}</div>
                    {t.detalhe && <div style={{ fontSize: 12, color: '#888' }}>{t.detalhe}</div>}
                  </TableCell>
                  <TableCell data-label="Categoria">{t.categoria}</TableCell>
                  <TableCell data-label="Valor">
                    <span style={{ color: t.tipo === 'entrada' ? '#3ecf8e' : '#ef4444', fontWeight: 600 }}>
                      {t.tipo === 'entrada' ? '+' : '-'}{formatBRL(t.valor)}
                    </span>
                  </TableCell>
                  <TableCell data-label="Status">
                    <Badge variant={t.status === 'pago' ? 'default' : 'secondary'}>
                      {t.status === 'pago' ? 'Pago' : 'Agendado'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
                      {t.status === 'agendado' ? (
                        <Button size="sm" onClick={() => setConfirmT(t)}>
                          <Check className="h-3 w-3" /> Confirmar
                        </Button>
                      ) : (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(t)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          {t.id && (
                            <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(t.id!)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modal de edição/criação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Transação' : modalTipo === 'entrada' ? 'Registrar Entrada' : 'Registrar Saída'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input value={fDescricao} onChange={e => setFDescricao(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input type="number" min={0} step={0.01} value={fValor} onChange={e => setFValor(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={fData} onChange={e => setFData(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Categoria</Label>
              <Select value={fCategoria} onValueChange={setFCategoria}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar pagamento */}
      <AlertDialog open={!!confirmT} onOpenChange={open => { if (!open) setConfirmT(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirmar pagamento?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPago}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover esta transação?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
