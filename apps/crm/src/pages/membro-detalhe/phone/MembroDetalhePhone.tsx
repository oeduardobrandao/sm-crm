import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PhoneCrudRow, PhoneStatusPill } from '@/components/phone-crud/PhoneCrudRow';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { Skeleton } from '@/components/ui/skeleton';
import { CardListSkeleton, SkeletonStatus } from '@/components/ui/skeletons';
import { avatarColorClass } from '@/lib/avatarColor';
import { cn } from '@/lib/utils';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { formatDate, getInitials, type Membro, type Transacao } from '../../../store';
import './membroDetalhePhone.css';

const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

export interface MembroDetalhePhoneProps {
  membro: Membro | undefined;
  loadingMembro: boolean;
  canEditTeam: boolean;
  canSeeFinancials: FinancialAccess;
  transacoes: Transacao[];
  loadingTransacoes: boolean;
  totalPago: number;
  pendente: number;
  onEdit: () => void;
}

/**
 * Membro detalhe below 768px (FMembro mockup): a pushed screen with Back to Equipe and
 * Editar in the nav bar, the member's header, three KPI cells, Informações as value rows
 * and the member's transactions (or the restricted notice).
 */
export function MembroDetalhePhone({
  membro,
  loadingMembro,
  canEditTeam,
  canSeeFinancials,
  transacoes,
  loadingTransacoes,
  totalPago,
  pendente,
  onEdit,
}: MembroDetalhePhoneProps) {
  const navBar = (
    <PhoneNavBar
      backLabel="Voltar para Equipe"
      fallbackTo="/equipe"
      trailing={
        canEditTeam && membro ? (
          <button type="button" className="phone-crud-pill-button" onClick={onEdit}>
            Editar
          </button>
        ) : undefined
      }
    />
  );

  if (!membro) {
    return (
      <div className="phone-crud-page">
        {navBar}
        {loadingMembro ? (
          <SkeletonStatus>
            <div className="phone-membro-head">
              <Skeleton className="h-[60px] w-[60px] shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-40 max-w-full" />
                <Skeleton className="h-3.5 w-28 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-28 w-full rounded-2xl" />
          </SkeletonStatus>
        ) : (
          <p className="phone-crud-empty">Membro não encontrado.</p>
        )}
      </div>
    );
  }

  const kpis = [
    { label: 'Custo mensal', value: membro.custo_mensal, dot: 'cost' },
    { label: 'Total pago', value: totalPago, dot: 'paid' },
    { label: 'Pendente', value: pendente, dot: 'pending' },
  ] as const;

  return (
    <div className="phone-crud-page">
      {navBar}
      <div className="phone-membro-head">
        <span
          className={cn(
            'avatar phone-crud-avatar phone-crud-avatar--large',
            avatarColorClass(membro.id ?? membro.nome),
          )}
          aria-hidden="true"
        >
          {getInitials(membro.nome)}
        </span>
        <div className="phone-membro-head__text">
          <h1 className="phone-membro-head__name">{membro.nome}</h1>
          {membro.cargo && <p className="phone-membro-head__role">{membro.cargo}</p>}
        </div>
      </div>

      {canEditTeam && (
        <div className="phone-kit phone-membro-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="phone-membro-kpis__cell">
              <span className="phone-membro-kpis__label">
                <span
                  className={`phone-membro-kpis__dot phone-membro-kpis__dot--${k.dot}`}
                  aria-hidden="true"
                />
                {k.label}
              </span>
              <strong className="phone-membro-kpis__value">
                {formatFinancialBRL(k.value, canSeeFinancials)}
              </strong>
            </div>
          ))}
        </div>
      )}

      <GroupedList header="Informações">
        <Cell label="Cargo" value={membro.cargo || '—'} />
        <Cell label="Tipo" value={TIPO_LABEL[membro.tipo]} />
        {canEditTeam && <Cell label="Dia de pagamento" value={membro.data_pagamento ?? '—'} />}
        {canEditTeam && (
          <Cell
            label="Custo mensal"
            value={formatFinancialBRL(membro.custo_mensal, canSeeFinancials)}
          />
        )}
      </GroupedList>

      {canEditTeam &&
        (canSeeFinancials === true ? (
          loadingTransacoes ? (
            <CardListSkeleton />
          ) : transacoes.length === 0 ? (
            <GroupedList header="Transações">
              <Cell label="Nenhuma transação" />
            </GroupedList>
          ) : (
            <GroupedList header="Transações">
              {transacoes.map((t, i) => (
                <PhoneCrudRow
                  key={t.id ?? `tx-${i}`}
                  title={t.descricao}
                  subtitle={[formatDate(t.data), t.categoria].filter(Boolean).join(' · ')}
                  aside={
                    <>
                      <span className="phone-crud-amount">
                        {formatFinancialBRL(t.valor, canSeeFinancials)}
                      </span>
                      <PhoneStatusPill tone={t.status === 'pago' ? 'success' : 'neutral'}>
                        {t.status === 'pago' ? 'Pago' : 'Agendado'}
                      </PhoneStatusPill>
                    </>
                  }
                />
              ))}
            </GroupedList>
          )
        ) : (
          // The fetch is gated on canSeeFinancials, so an empty list here would read as
          // "no transactions". Say why it's hidden instead (same as desktop).
          <div className="phone-crud-notice">
            <RoleRestrictionNotice
              title="Transações"
              description="A visualização de transações financeiras está disponível apenas para quem tem acesso financeiro liberado."
            />
          </div>
        ))}
    </div>
  );
}
