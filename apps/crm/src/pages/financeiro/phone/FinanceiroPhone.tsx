import { useMemo, useState } from 'react';
import { format, type Locale } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
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

function dayHeader(iso: string, t: TFunction, locale: Locale): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  // "sábado, 10 de outubro" (the header is uppercased by CSS); weekdays drop "-feira".
  return format(
    date,
    sameYear ? t('common:dateFormat.weekdayDayMonth') : t('phone.dayHeaderWithYear'),
    { locale },
  ).replace('-feira', '');
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
  const { t } = useTranslation('finance');
  const money = (v: number) => formatFinancialBRL(v, access);
  const tone = (v: number) => (access === true ? (v >= 0 ? 'in' : 'out') : undefined);
  return (
    <section className="phone-kit phone-fin-summary" aria-label={t('phone.summaryAria')}>
      <div className="phone-fin-summary__main">
        {(
          [
            [t('shared.kpis.currentBalance'), kpis.saldoAtual],
            [t('shared.kpis.projectedBalance'), kpis.saldoProjetado],
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
            [t('shared.kpis.received'), kpis.recebido, 'in'],
            [t('shared.kpis.toReceive'), kpis.aReceber, 'pending'],
            [t('shared.kpis.toPay'), kpis.aPagar, 'out'],
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
  const { t } = useTranslation('finance');
  usePhoneChrome({ pageHeader: true, tabBar: false });
  return (
    <header className="phone-kit phone-crud-select-bar">
      <button type="button" className="phone-text-button" onClick={onCancel}>
        {t('actions.cancel')}
      </button>
      <h1 className="phone-crud-select-bar__title">
        {count === 0 ? t('phone.select') : t('phone.selected', { count })}
      </h1>
      <button
        type="button"
        className="phone-text-button phone-text-button--strong"
        disabled={!canSelectAll}
        onClick={onToggleAll}
      >
        {allSelected ? t('phone.deselectAll') : t('phone.selectAll')}
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
  const { t } = useTranslation('finance');
  const dateLocale = useDateFnsLocale();
  const filterOptions = [
    { value: 'todas' as const, label: t('shared.filters.all') },
    { value: 'entradas' as const, label: t('shared.filters.income') },
    { value: 'saidas' as const, label: t('shared.filters.expenses') },
  ];
  const [addOpen, setAddOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const searchToggle = usePhoneSearch(search, onSearchChange);
  const groups = useMemo(() => groupByDay(transacoes), [transacoes]);
  const hasScheduled = transacoes.some((t) => t.status === 'agendado');

  const amount = (tr: Transacao) => {
    const sign = tr.tipo === 'entrada' ? '+' : '-';
    // Paid rows carry the in/out colour; scheduled ones stay neutral until confirmed.
    const tone = tr.status === 'pago' ? (tr.tipo === 'entrada' ? 'in' : 'out') : null;
    return (
      <span className={cn('phone-crud-amount', tone && `phone-crud-amount--${tone}`)}>
        {sign}
        {formatFinancialBRL(tr.valor, canSeeFinancials)}
      </span>
    );
  };

  const rowActions = (tr: Transacao): { swipe: SwipeAction[]; menu: ContextMenuAction[][] } => {
    if (tr.status === 'agendado') {
      return {
        swipe: [
          {
            label: t('actions.confirm'),
            icon: <Check aria-hidden="true" />,
            tone: 'success',
            onAction: () => onConfirm(tr),
          },
        ],
        menu: [
          [
            {
              label: t('phone.confirmPayment'),
              icon: <Check aria-hidden="true" />,
              onSelect: () => onConfirm(tr),
            },
          ],
        ],
      };
    }
    const swipe: SwipeAction[] = [
      { label: t('actions.edit'), icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(tr) },
    ];
    const menu: ContextMenuAction[][] = [
      [
        {
          label: t('actions.edit'),
          icon: <Edit2 aria-hidden="true" />,
          onSelect: () => onEdit(tr),
        },
      ],
    ];
    if (tr.id) {
      const id = tr.id;
      swipe.push({
        label: t('actions.delete'),
        icon: <Trash2 aria-hidden="true" />,
        tone: 'destructive',
        onAction: () => onDelete(id),
      });
      menu.push([
        {
          label: t('actions.delete'),
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
      aria-label={t('phone.typeAria')}
      options={filterOptions}
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
          title={t('shared.title')}
          subtitle={t('shared.description')}
          actions={
            <>
              {searchToggle.button}
              <button
                type="button"
                className="phone-crud-pill-button"
                onClick={() => onSelectingChange(true)}
              >
                {t('phone.select')}
              </button>
              <PhoneIconButton
                label={onRecorrentes ? t('phone.addMenuWithRecurring') : t('phone.addMenu')}
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
              placeholder={t('shared.searchPlaceholder')}
            />
          )}
        </PhonePageHeader>
      )}

      {!selecting && <Summary kpis={kpis} access={canSeeFinancials} />}
      {segmented}
      {!selecting && (
        <GroupedList aria-label={t('phone.periodAria')}>
          <Cell
            icon={<CalendarDays aria-hidden="true" />}
            label={t('shared.month')}
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
        <p className="phone-crud-empty">{t('phone.empty')}</p>
      ) : (
        groups.map(({ day, items }) => (
          <GroupedList key={day} header={dayHeader(day, t, dateLocale)}>
            {items.map((tr) => {
              const { swipe, menu } = rowActions(tr);
              const scheduled = tr.status === 'agendado';
              return (
                <PhoneCrudRow
                  key={rowKey(tr)}
                  leading={
                    <span
                      role="img"
                      aria-label={tr.tipo === 'entrada' ? t('shared.income') : t('shared.expense')}
                      className={`phone-crud-tile phone-crud-tile--${tr.tipo === 'entrada' ? 'in' : 'out'}`}
                    >
                      {tr.tipo === 'entrada' ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                  }
                  title={tr.descricao}
                  subtitle={[tr.categoria, tr.detalhe].filter(Boolean).join(' · ') || undefined}
                  aside={
                    <>
                      {amount(tr)}
                      <PhoneStatusPill tone={scheduled ? 'neutral' : 'success'}>
                        {scheduled ? t('status.agendado') : t('status.pago')}
                      </PhoneStatusPill>
                    </>
                  }
                  onOpen={scheduled ? () => onConfirm(tr) : () => onEdit(tr)}
                  swipeActions={swipe}
                  menuLabel={t('phone.rowActions', { descricao: tr.descricao })}
                  menuSections={menu}
                  selection={
                    selecting
                      ? {
                          selectable: scheduled,
                          selected: selectedKeys.has(rowKey(tr)),
                          onToggle: () => onToggle(tr),
                          label: t('phone.selectRow', { descricao: tr.descricao }),
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
            {selectedCount === 0 ? t('actions.confirm') : t('phone.confirmN', { n: selectedCount })}
          </button>
        </BottomActionBar>
      )}

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('actions.add')}
        message={t('shared.csvHelp')}
        actions={[
          {
            label: t('shared.income'),
            icon: <ArrowDownLeft aria-hidden="true" />,
            onSelect: () => onAdd('entrada'),
          },
          {
            label: t('shared.expense'),
            icon: <ArrowUpRight aria-hidden="true" />,
            onSelect: () => onAdd('saida'),
          },
          {
            label: t('actions.importCsv'),
            icon: <Upload aria-hidden="true" />,
            // The file picker needs the tap itself (iOS Safari blocks a deferred click).
            immediate: true,
            onSelect: onImport,
          },
          ...(onRecorrentes
            ? [
                {
                  label: t('shared.recurring'),
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
