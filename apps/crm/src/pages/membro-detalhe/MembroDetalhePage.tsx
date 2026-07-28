import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Edit2, Wallet, CheckCircle2, Clock } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getMembros,
  getTransacoes,
  formatDate,
  getInitials,
  updateMembro,
  type Membro,
} from '../../store';
import { useAuth } from '../../context/AuthContext';
import { avatarColorClass } from '@/lib/avatarColor';
import { formatFinancialBRL, stripFinancialFields } from '@/lib/financialAccess';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';

const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

export default function MembroDetalhePage() {
  const { role, canSeeFinancials } = useAuth();
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

  // The edit modal can hold a custo_mensal value in its form state. On live
  // revocation, close it rather than let the value linger on screen.
  useEffect(() => {
    if (canSeeFinancials !== true) setModalOpen(false);
  }, [canSeeFinancials]);

  const { data: membros = [], isLoading: loadingMembros } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  // getTransacoes returns raw financial rows: this page is not a financial
  // route, so the route guard never covers it. Gate the fetch on the
  // capability itself, not just `!isAgent` (a restricted admin is not an
  // agent either).
  const { data: transacoesRaw = [], isLoading: loadingTx } = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
    enabled: canSeeFinancials === true,
  });
  // Guard the read too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (matches
  // GlobalSearchTrigger's pattern) can still leave cached data on this hook.
  const transacoes = canSeeFinancials === true ? transacoesRaw : [];

  const membro = membros.find((m) => m.id?.toString() === id);

  if (!loadingMembros && !membro) {
    return (
      <div style={{ padding: '2rem' }}>
        <Button variant="outline" onClick={() => navigate('/equipe')}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <p style={{ marginTop: 16 }}>Membro não encontrado.</p>
      </div>
    );
  }

  const membroTx = transacoes.filter(
    (t) =>
      (membro && t.descricao?.includes(membro.nome)) ||
      t.referencia_agendamento?.includes(`membro_${id}`),
  );
  const totalPago = membroTx.filter((t) => t.status === 'pago').reduce((s, t) => s + t.valor, 0);
  const pendente = membroTx.filter((t) => t.status === 'agendado').reduce((s, t) => s + t.valor, 0);

  const openEdit = () => {
    if (!membro) return;
    setFNome(membro.nome);
    setFCargo(membro.cargo || '');
    setFTipo(membro.tipo);
    setFCusto(membro.custo_mensal ? String(membro.custo_mensal) : '');
    setFDiaPag(membro.data_pagamento ? String(membro.data_pagamento) : '');
    setModalOpen(true);
  };

  const handleSave = async () => {
    const diaPag = fDiaPag ? parseInt(fDiaPag, 10) : undefined;
    if (diaPag !== undefined && (isNaN(diaPag) || diaPag < 1 || diaPag > 31)) {
      toast.error('Dia de pagamento deve ser entre 1 e 31.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: fNome,
        cargo: fCargo,
        tipo: fTipo,
        custo_mensal: fCusto ? Number(fCusto) : null,
        data_pagamento: diaPag,
      } as Partial<Omit<Membro, 'id' | 'user_id' | 'conta_id'>>;
      await updateMembro(
        Number(id),
        stripFinancialFields(payload, canSeeFinancials, ['custo_mensal']),
      );
      toast.success('Membro atualizado');
      qc.invalidateQueries({ queryKey: ['membros'] });
      setModalOpen(false);
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const avatarClass = avatarColorClass(membro?.id ?? membro?.nome);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <Button variant="outline" onClick={() => navigate('/equipe')}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        {!isAgent && (
          <div className="header-actions">
            <Button variant="outline" onClick={openEdit}>
              <Edit2 className="h-4 w-4" /> Editar
            </Button>
          </div>
        )}
      </div>

      {(loadingMembros || loadingTx) && (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      )}

      {membro && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '1.5rem 0' }}>
            <div
              className={`avatar ${avatarClass}`}
              style={{ fontWeight: 700, width: 56, height: 56, fontSize: 22 }}
            >
              {getInitials(membro.nome)}
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{membro.nome}</h2>
              <div style={{ color: '#888' }}>{membro.cargo}</div>
            </div>
          </div>

          {!isAgent && (
            <StatCardGrid style={{ marginBottom: '1.5rem' }}>
              {(
                [
                  {
                    label: 'Custo mensal',
                    value: formatFinancialBRL(membro.custo_mensal, canSeeFinancials),
                    icon: Wallet,
                    tone: 'blue' as const,
                  },
                  {
                    label: 'Total pago',
                    value: formatFinancialBRL(totalPago, canSeeFinancials),
                    icon: CheckCircle2,
                    tone: 'green' as const,
                  },
                  {
                    label: 'Pendente',
                    value: formatFinancialBRL(pendente, canSeeFinancials),
                    icon: Clock,
                    tone: 'amber' as const,
                  },
                ] as const
              ).map((k) => (
                <StatCard
                  key={k.label}
                  label={k.label}
                  value={k.value}
                  icon={k.icon}
                  tone={k.tone}
                  compactValue
                />
              ))}
            </StatCardGrid>
          )}

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: 12 }}>Informações</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <strong>Cargo:</strong> {membro.cargo}
              </div>
              <div>
                <strong>Tipo:</strong> {TIPO_LABEL[membro.tipo]}
              </div>
              {!isAgent && (
                <div>
                  <strong>Dia de Pagamento:</strong> {membro.data_pagamento ?? '—'}
                </div>
              )}
              {!isAgent && (
                <div>
                  <strong>Custo Mensal:</strong>{' '}
                  {formatFinancialBRL(membro.custo_mensal, canSeeFinancials)}
                </div>
              )}
            </div>
          </div>

          {!isAgent && (
            <>
              <h3 style={{ marginBottom: 12 }}>Transações</h3>
              {canSeeFinancials === true ? (
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
                          <TableCell data-label="Valor">
                            {formatFinancialBRL(t.valor, canSeeFinancials)}
                          </TableCell>
                          <TableCell data-label="Status">{t.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                // The query above is gated on canSeeFinancials === true, so
                // membroTx is always [] here — an empty table would read as
                // "this member has no transactions", which is false for a
                // restricted admin. Say why it's hidden instead.
                <div className="card">
                  <RoleRestrictionNotice
                    title="Transações"
                    description="A visualização de transações financeiras está disponível apenas para quem tem acesso financeiro liberado."
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent onConfirmClose={() => setModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Editar Membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={fNome} onChange={(e) => setFNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cargo *</Label>
              <Input value={fCargo} onChange={(e) => setFCargo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={fTipo} onValueChange={(v) => setFTipo(v as Membro['tipo'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clt">CLT</SelectItem>
                  <SelectItem value="freelancer_mensal">Freelancer Mensal</SelectItem>
                  <SelectItem value="freelancer_demanda">Freelancer Demanda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canSeeFinancials === true && (
              <div className="space-y-1">
                <Label>Custo Mensal (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={fCusto}
                  onChange={(e) => setFCusto(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>Dia de Pagamento (1-31)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={fDiaPag}
                onChange={(e) => setFDiaPag(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size="sm" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
