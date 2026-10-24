import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  Edit2,
  Plus,
  Repeat,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import type { SwipeAction } from '@/components/mobile/SwipeRow';
import type { ContextMenuAction } from '@/components/mobile/ContextMenu';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import { PhoneCrudRow, PhoneStatusPill } from '@/components/phone-crud/PhoneCrudRow';
import { PhoneSearchField, usePhoneSearch } from '@/components/phone-crud/PhoneSearchField';
import { CardListSkeleton } from '@/components/ui/skeletons';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import type { Transacao } from '../../../store';
import { MonthSheet, monthLabel } from './MonthSheet';
import './financeiroPhone.css';

export type FinanceiroFilter = 'todas' | 'entradas' | 'saidas';

export interface FinanceiroKpis {
  recebido: number;
  aReceber: number;
  aPagar: number;
  saldoAtual: number;
  saldoProjetado: number;
}

export interface FinanceiroPhoneProps {
  isLoading: boolean;
  transacoes: Transacao[];
  canSeeFinancials: FinancialAccess;
  kpis: FinanceiroKpis;
  filter: FinanceiroFilter;
  onFilterChange: (filter: FinanceiroFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  monthFilter: string;
  onMonthFilterChange: (month: string) => void;
  onAdd: (tipo: 'entrada' | 'saida') => void;
  onImport: () => void;
  /** Opens the recurring lançamentos list; absent when the user cannot see financials. */
  onRecorrentes?: () => void;
  onEdit: (t: Transacao) => void;
  onConfirm: (t: Transacao) => void;
  onDelete: (id: number) => void;
  /** Selection mode (bulk confirm), owned by the page so a finished bulk confirm can end it. */
  selecting: boolean;
  onSelectingChange: (selecting: boolean) => void;
  rowKey: (t: Transacao) => string;
  selectedKeys: Set<string>;
  onToggle: (t: Transacao) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  selectedCount: number;
  onBulkConfirm: () => void;
}

/** Same copy as the desktop CSV HelpTooltip. */
export const FINANCEIRO_CSV_HELP =
  'Colunas CSV: descricao*, valor*, data* (AAAA-MM-DD), tipo (entrada|saida), categoria, detalhe. Categorias válidas: Mensalidade, Produção, Tráfego, Salário, Imposto, Ferramenta, Outro.';

const FILTER_OPTIONS = [
  { value: 'todas' as const, label: 'Todas' },
  { value: 'entradas' as const, label: 'Entradas' },
  { value: 'saidas' as const, label: 'Saídas' },
];

function dayHeader(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  // "sábado, 10 de outubro" (the header is uppercased by CSS); weekdays drop "-feira".
  return format(date, sameYear ? "EEEE, d 'de' MMMM" : "EEEE, d 'de' MMMM 'de' yyyy", {
    locale: ptBR,
  }).replace('-feira', '');
}

function groupByDay(list: Transacao[]): { day: string; items: Transacao[] }[] {
  const groups = new Map<string, Transacao[]>();
  for (const t of list) {
    const items = groups.get(t.data);
    if (items) items.push(t);
    else groups.set(t.data, [t]);
  }
  return Array.from(groups, ([day, items]) => ({ day, items }));
}

function Summary({ kpis, access }: { kpis: FinanceiroKpis; access: FinancialAccess }) {
  const money = (v: number) => formatFinancialBRL(v, access);
  const tone = (v: number) => (access === true ? (v >= 0 ? 'in' : 'out') : undefined);
  return (
    <section className="phone-kit phone-fin-summary" aria-label="Resumo do mês">
      <div className="phone-fin-summary__main">
        {(
          [
            ['Saldo atual', kpis.saldoAtual],
            ['Saldo projetado', kpis.saldoProjetado],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="phone-fin-summary__cell">
            <span className="phone-fin-summary__label">{label}</span>
            <strong
              className={cn(
                'phone-fin-summary__big',
                tone(value) && `phone-fin-summary__big--${tone(value)}`,
              )}
            >
              {money(value)}
            </strong>
          </div>
        ))}
      </div>
      <div className="phone-fin-summary__minor">
        {(
          [
            ['Recebido', kpis.recebido, 'in'],
            ['A receber', kpis.aReceber, 'pending'],
            ['A pagar', kpis.aPagar, 'out'],
          ] as const
        ).map(([label, value, dot]) => (
          <div key={label} className="phone-fin-summary__cell">
            <span className="phone-fin-summary__label">
              <span
                className={`phone-fin-summary__dot phone-fin-summary__dot--${dot}`}
                aria-hidden="true"
              />
              {label}
            </span>
            <strong className="phone-fin-summary__small">{money(value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Selection-mode header: hides the tab bar, the bottom action bar takes its place. */
function SelectionBar({
  count,
  allSelected,
  canSelectAll,
  onCancel,
  onToggleAll,
}: {
  count: number;
  allSelected: boolean;
  canSelectAll: boolean;
  onCancel: () => void;
  onToggleAll: () => void;
}) {
  usePhoneChrome({ pageHeader: true, tabBar: false });
  return (
    <header className="phone-kit phone-crud-select-bar">
      <button type="button" className="phone-text-button" onClick={onCancel}>
        Cancelar
      </button>
      <h1 className="phone-crud-select-bar__title">
        {count === 0 ? 'Selecionar' : count === 1 ? '1 selecionada' : `${count} selecionadas`}
      </h1>
      <button
        type="button"
        className="phone-text-button phone-text-button--strong"
        disabled={!canSelectAll}
        onClick={onToggleAll}
      >
        {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
      </button>
    </header>
  );
}

/**
 * Financeiro below 768px (FFinanceiro, FFinanceiroSelecao, FTransacaoForm mockups): page
 * header with the description as subtitle, a compact summary of the five KPIs, the type
 * segmented control, the month row and the transactions grouped by day. Scheduled rows
 * confirm by swipe, long-press or tap; paid rows edit and remove. "Selecionar" turns on
 * bulk confirm, which the old phone cards never had. The page owns state, writes and
 * dialogs; this only draws them.
 */
export function FinanceiroPhone(props: FinanceiroPhoneProps) {
  const {
    isLoading,
    transacoes,
    canSeeFinancials,
    kpis,
    filter,
    onFilterChange,
    search,
    onSearchChange,
    monthFilter,
    onMonthFilterChange,
    onAdd,
    onImport,
    onRecorrentes,
    onEdit,
    onConfirm,
    onDelete,
    selecting,
    onSelectingChange,
    rowKey,
    selectedKeys,
    onToggle,
    onToggleAll,
    allSelected,
    selectedCount,
    onBulkConfirm,
  } = props;
  const [addOpen, setAddOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const searchToggle = usePhoneSearch(search, onSearchChange);
  const groups = useMemo(() => groupByDay(transacoes), [transacoes]);
  const hasScheduled = transacoes.some((t) => t.status === 'agendado');

  const amount = (t: Transacao) => {
    const sign = t.tipo === 'entrada' ? '+' : '-';
    // Paid rows carry the in/out colour; scheduled ones stay neutral until confirmed.
    const tone = t.status === 'pago' ? (t.tipo === 'entrada' ? 'in' : 'out') : null;
    return (
      <span className={cn('phone-crud-amount', tone && `phone-crud-amount--${tone}`)}>
        {sign}
        {formatFinancialBRL(t.valor, canSeeFinancials)}
      </span>
    );
  };

  const rowActions = (t: Transacao): { swipe: SwipeAction[]; menu: ContextMenuAction[][] } => {
    if (t.status === 'agendado') {
      return {
        swipe: [
          {
            label: 'Confirmar',
            icon: <Check aria-hidden="true" />,
            tone: 'success',
            onAction: () => onConfirm(t),
          },
        ],
        menu: [
          [
            {
              label: 'Confirmar pagamento',
              icon: <Check aria-hidden="true" />,
              onSelect: () => onConfirm(t),
            },
          ],
        ],
      };
    }
    const swipe: SwipeAction[] = [
      { label: 'Editar', icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(t) },
    ];
    const menu: ContextMenuAction[][] = [
      [{ label: 'Editar', icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(t) }],
    ];
    if (t.id) {
      const id = t.id;
      swipe.push({
        label: 'Remover',
        icon: <Trash2 aria-hidden="true" />,
        tone: 'destructive',
        onAction: () => onDelete(id),
      });
      menu.push([
        {
          label: 'Remover',
          icon: <Trash2 aria-hidden="true" />,
          destructive: true,
          onSelect: () => onDelete(id),
        },
      ]);
    }
    return { swipe, menu };
  };

  const segmented = (
    <SegmentedControl
      aria-label="Tipo de transação"
      options={FILTER_OPTIONS}
      value={filter}
      onChange={onFilterChange}
      className="phone-crud-block"
    />
  );

  return (
    <div className="phone-crud-page">
      {selecting ? (
        <SelectionBar
          count={selectedCount}
          allSelected={allSelected}
          canSelectAll={hasScheduled}
          onCancel={() => onSelectingChange(false)}
          onToggleAll={onToggleAll}
        />
      ) : (
        <PhonePageHeader
          title="Financeiro"
          subtitle="Visão das finanças, receitas projetadas e despesas."
          actions={
            <>
              {searchToggle.button}
              <button
                type="button"
                className="phone-crud-pill-button"
                onClick={() => onSelectingChange(true)}
              >
                Selecionar
              </button>
              <PhoneIconButton
                label={
                  onRecorrentes
                    ? 'Adicionar: Entrada, Saída, Importar CSV ou Recorrentes'
                    : 'Adicionar: Entrada, Saída ou Importar CSV'
                }
                variant="ink"
                aria-haspopup="dialog"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            </>
          }
        >
          {searchToggle.open && (
            <PhoneSearchField
              inputRef={searchToggle.inputRef}
              value={search}
              onChange={onSearchChange}
              placeholder="Buscar por descrição ou categoria..."
            />
          )}
        </PhonePageHeader>
      )}

      {!selecting && <Summary kpis={kpis} access={canSeeFinancials} />}
      {segmented}
      {!selecting && (
        <GroupedList aria-label="Período">
          <Cell
            icon={<CalendarDays aria-hidden="true" />}
            label="Mês"
            value={monthLabel(monthFilter)}
            chevron
            aria-haspopup="dialog"
            onClick={() => setMonthOpen(true)}
          />
        </GroupedList>
      )}

      {isLoading ? (
        <CardListSkeleton />
      ) : groups.length === 0 ? (
        <p className="phone-crud-empty">Nenhuma transação encontrada.</p>
      ) : (
        groups.map(({ day, items }) => (
          <GroupedList key={day} header={dayHeader(day)}>
            {items.map((t) => {
              const { swipe, menu } = rowActions(t);
              const scheduled = t.status === 'agendado';
              return (
                <PhoneCrudRow
                  key={rowKey(t)}
                  leading={
                    <span
                      role="img"
                      aria-label={t.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                      className={`phone-crud-tile phone-crud-tile--${t.tipo === 'entrada' ? 'in' : 'out'}`}
                    >
                      {t.tipo === 'entrada' ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                  }
                  title={t.descricao}
                  subtitle={[t.categoria, t.detalhe].filter(Boolean).join(' · ') || undefined}
                  aside={
                    <>
                      {amount(t)}
                      <PhoneStatusPill tone={scheduled ? 'neutral' : 'success'}>
                        {scheduled ? 'Agendado' : 'Pago'}
                      </PhoneStatusPill>
                    </>
                  }
                  onOpen={scheduled ? () => onConfirm(t) : () => onEdit(t)}
                  swipeActions={swipe}
                  menuLabel={`Ações de ${t.descricao}`}
                  menuSections={menu}
                  selection={
                    selecting
                      ? {
                          selectable: scheduled,
                          selected: selectedKeys.has(rowKey(t)),
                          onToggle: () => onToggle(t),
                          label: `Selecionar ${t.descricao}`,
                        }
                      : undefined
                  }
                />
              );
            })}
          </GroupedList>
        ))
      )}

      {selecting && (
        <BottomActionBar>
          <button
            type="button"
            className="phone-crud-primary"
            disabled={selectedCount === 0}
            onClick={onBulkConfirm}
          >
            {selectedCount === 0 ? 'Confirmar' : `Confirmar ${selectedCount}`}
          </button>
        </BottomActionBar>
      )}

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Adicionar"
        message={FINANCEIRO_CSV_HELP}
        actions={[
          {
            label: 'Entrada',
            icon: <ArrowDownLeft aria-hidden="true" />,
            onSelect: () => onAdd('entrada'),
          },
          {
            label: 'Saída',
            icon: <ArrowUpRight aria-hidden="true" />,
            onSelect: () => onAdd('saida'),
          },
          {
            label: 'Importar CSV',
            icon: <Upload aria-hidden="true" />,
            // The file picker needs the tap itself (iOS Safari blocks a deferred click).
            immediate: true,
            onSelect: onImport,
          },
          ...(onRecorrentes
            ? [
                {
                  label: 'Recorrentes',
                  icon: <Repeat aria-hidden="true" />,
                  onSelect: onRecorrentes,
                },
              ]
            : []),
        ]}
      />
      <MonthSheet
        open={monthOpen}
        onOpenChange={setMonthOpen}
        value={monthFilter}
        onChange={onMonthFilterChange}
      />
    </div>
  );
}
