import { useState } from 'react';
import { Camera, MoreHorizontal } from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { PhoneCrudRow, PhoneStatusPill } from '@/components/phone-crud/PhoneCrudRow';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { Skeleton } from '@/components/ui/skeleton';
import { CardListSkeleton, SkeletonStatus } from '@/components/ui/skeletons';
import { useFotoPessoa } from '@/hooks/useFotoPessoa';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { formatDate, type Membro, type Transacao } from '../../../store';
import './membroDetalhePhone.css';

const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

export interface MembroDetalhePhoneProps {
  membro: Membro | undefined;
  /** Login e-mail of the linked CRM account; empty when unlinked or not visible. */
  email?: string;
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
 * Membro detalhe below 768px (FMembro mockup): a pushed screen with Back to Equipe and,
 * for editors, a "…" sheet (Editar and the member's photo, like the client detail) in the
 * nav bar, the member's header, three KPI cells, Informações as value rows and the
 * member's transactions (or the restricted notice).
 */
export function MembroDetalhePhone({
  membro,
  email,
  loadingMembro,
  canEditTeam,
  canSeeFinancials,
  transacoes,
  loadingTransacoes,
  totalPago,
  pendente,
  onEdit,
}: MembroDetalhePhoneProps) {
  // A member without an id (never persisted) has no photo target; the hook still needs
  // one, and the editing UI below is only offered when the id exists.
  const membroId = membro?.id;
  const canEditFoto = canEditTeam && membroId != null;
  const foto = useFotoPessoa({ kind: 'membro', membroId: membroId ?? 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const temFoto = !!membro?.avatar_url;

  const menuActions: ActionSheetAction[] = [{ label: 'Editar', onSelect: onEdit }];
  if (canEditFoto) {
    // `immediate`: the file picker only opens inside the tap on iOS Safari.
    menuActions.push(
      { label: temFoto ? 'Alterar foto' : 'Adicionar foto', onSelect: foto.pick, immediate: true },
      { label: 'Tirar foto', onSelect: foto.pickCamera, immediate: true },
    );
    if (temFoto)
      menuActions.push({
        label: 'Remover foto',
        destructive: true,
        onSelect: () => setRemoveOpen(true),
      });
  }

  const navBar = (
    <PhoneNavBar
      backLabel="Voltar para Equipe"
      fallbackTo="/equipe"
      trailing={
        canEditTeam && membro ? (
          <PhoneIconButton
            label="Mais ações do membro"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" />
          </PhoneIconButton>
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

  const avatar = (
    <PessoaAvatar
      nome={membro.nome}
      fotoUrl={membro.avatar_url}
      seed={membro.id}
      className="phone-crud-avatar phone-crud-avatar--large"
    />
  );

  return (
    <div className="phone-crud-page">
      {navBar}
      <div className="phone-membro-head">
        {canEditFoto ? (
          <button
            type="button"
            className="relative shrink-0 rounded-full p-0 disabled:opacity-60"
            aria-label={`${temFoto ? 'Alterar' : 'Adicionar'} foto de ${membro.nome}`}
            disabled={foto.uploading}
            onClick={foto.pick}
          >
            {avatar}
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--card-bg)] bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Camera size={12} />
            </span>
          </button>
        ) : (
          avatar
        )}
        <div className="phone-membro-head__text">
          <h1 className="phone-membro-head__name">{membro.nome}</h1>
          {membro.cargo && <p className="phone-membro-head__role">{membro.cargo}</p>}
          {email && <p className="phone-membro-head__role">{email}</p>}
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

      {canEditFoto && (
        <>
          <input {...foto.inputProps} className="hidden" aria-hidden="true" tabIndex={-1} />
          <input {...foto.cameraInputProps} className="hidden" aria-hidden="true" tabIndex={-1} />
        </>
      )}
      {canEditTeam && (
        <ActionSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={membro.nome}
          hideTitle
          actions={menuActions}
        />
      )}
      {canEditFoto && (
        <PhoneConfirmSheet
          open={removeOpen}
          title="Remover a foto?"
          message="Volta a aparecer as iniciais."
          actions={[
            {
              label: 'Remover',
              destructive: true,
              onSelect: () => {
                setRemoveOpen(false);
                void foto.remove();
              },
            },
          ]}
          onCancel={() => setRemoveOpen(false)}
        />
      )}
    </div>
  );
}
