import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Edit2, Wallet, CheckCircle2, Clock } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus, TableSkeleton } from '@/components/ui/skeletons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getMembros, getTransacoes, formatDate, getInitials } from '../../store';
import { useAuth } from '../../context/AuthContext';
import { avatarColorClass } from '@/lib/avatarColor';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { MembroFormDialog } from '../equipe/MembroFormDialog';

const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

export default function MembroDetalhePage() {
  const { canSeeFinancials, can } = useAuth();
  const canEditTeam = can('equipe', 'editar') === true;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: membros = [], isLoading: loadingMembros } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  // getTransacoes returns raw financial rows: this page is not a financial
  // route, so the route guard never covers it. Gate the fetch on the
  // capability itself, not just `canEditTeam` (a restricted admin is not an
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
    setModalOpen(true);
  };

  const avatarClass = avatarColorClass(membro?.id ?? membro?.nome);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <Button variant="outline" onClick={() => navigate('/equipe')}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        {canEditTeam && (
          <div className="header-actions">
            <Button variant="outline" onClick={openEdit}>
              <Edit2 className="h-4 w-4" /> Editar
            </Button>
          </div>
        )}
      </div>

      {loadingMembros && !membro && (
        <SkeletonStatus>
          <div className="flex items-center gap-4" style={{ margin: '1.5rem 0' }}>
            <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-3.5 w-32 max-w-full" />
            </div>
          </div>
          {canEditTeam && (
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              style={{ marginBottom: '1.5rem' }}
            >
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          )}
          <Skeleton className="h-28 w-full" />
        </SkeletonStatus>
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

          {canEditTeam && (
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
              {canEditTeam && (
                <div>
                  <strong>Dia de Pagamento:</strong> {membro.data_pagamento ?? '—'}
                </div>
              )}
              {canEditTeam && (
                <div>
                  <strong>Custo Mensal:</strong>{' '}
                  {formatFinancialBRL(membro.custo_mensal, canSeeFinancials)}
                </div>
              )}
            </div>
          </div>

          {canEditTeam && (
            <>
              <h3 style={{ marginBottom: 12 }}>Transações</h3>
              {canSeeFinancials === true && loadingTx ? (
                <TableSkeleton rows={3} columns={5} />
              ) : canSeeFinancials === true ? (
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

      <MembroFormDialog
        open={modalOpen}
        membro={membro ?? null}
        membros={membros}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}
