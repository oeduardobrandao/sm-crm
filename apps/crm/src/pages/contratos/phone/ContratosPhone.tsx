import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { Edit2, MoreHorizontal, Plus, Trash2, Upload, UserRound } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { ChipRow, Chip } from '@/components/mobile/ChipRow';
import { GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import type { SwipeAction } from '@/components/mobile/SwipeRow';
import type { ContextMenuAction } from '@/components/mobile/ContextMenu';
import { PhoneCrudRow, PhoneStatusPill } from '@/components/phone-crud/PhoneCrudRow';
import { PhoneSearchField, usePhoneSearch } from '@/components/phone-crud/PhoneSearchField';
import { CardListSkeleton } from '@/components/ui/skeletons';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { formatDate, type Contrato } from '../../../store';

export type ContratosFilter = 'todos' | 'vigente' | 'a_assinar' | 'encerrado';

/** Same copy as the desktop CSV tooltip (resolved at call time, follows the UI language). */
export const contratosCsvHelp = () => i18n.t('contracts:csvHelp');

const FILTER_VALUES: ContratosFilter[] = ['todos', 'vigente', 'a_assinar', 'encerrado'];

const STATUS_TONE: Record<Contrato['status'], 'success' | 'warning' | 'neutral'> = {
  vigente: 'success',
  a_assinar: 'warning',
  encerrado: 'neutral',
};

export interface ContratosPhoneProps {
  isLoading: boolean;
  contratos: Contrato[];
  canSeeValues: FinancialAccess;
  filter: ContratosFilter;
  onFilterChange: (filter: ContratosFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (c: Contrato) => void;
  onDelete: (id: number) => void;
  onOpenCliente: (clienteId: number) => void;
  /** Ex-reverse-trial workspace on Free: list only, no create, edit, import or delete. */
  readOnly?: boolean;
}

/**
 * Contratos below 768px (FContratos mockup): page header with search, "…" (Importar CSV
 * and its columns) and the ink "+", status chips and one row per contract. Tapping a row
 * opens the edit sheet; swipe and long-press reach Editar / Remover and the client.
 */
export function ContratosPhone({
  isLoading,
  contratos,
  canSeeValues,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  onAdd,
  onImport,
  onEdit,
  onDelete,
  onOpenCliente,
  readOnly = false,
}: ContratosPhoneProps) {
  const { t } = useTranslation('contracts');
  const [moreOpen, setMoreOpen] = useState(false);
  const searchToggle = usePhoneSearch(search, onSearchChange);

  const actionsFor = (c: Contrato): { swipe: SwipeAction[]; menu: ContextMenuAction[][] } => {
    if (readOnly) {
      const clienteId = c.cliente_id;
      return {
        swipe: [],
        menu: clienteId
          ? [
              [
                {
                  label: t('form.openClient'),
                  icon: <UserRound aria-hidden="true" />,
                  onSelect: () => onOpenCliente(clienteId),
                },
              ],
            ]
          : [],
      };
    }
    const swipe: SwipeAction[] = [
      { label: t('phone.edit'), icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(c) },
    ];
    const menu: ContextMenuAction[][] = [
      [{ label: t('phone.edit'), icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(c) }],
    ];
    if (c.cliente_id) {
      const clienteId = c.cliente_id;
      menu[0].push({
        label: t('form.openClient'),
        icon: <UserRound aria-hidden="true" />,
        onSelect: () => onOpenCliente(clienteId),
      });
    }
    if (c.id) {
      const id = c.id;
      swipe.push({
        label: t('phone.remove'),
        icon: <Trash2 aria-hidden="true" />,
        tone: 'destructive',
        onAction: () => onDelete(id),
      });
      menu.push([
        {
          label: t('phone.remove'),
          icon: <Trash2 aria-hidden="true" />,
          destructive: true,
          onSelect: () => onDelete(id),
        },
      ]);
    }
    return { swipe, menu };
  };

  return (
    <div className="phone-crud-page">
      <PhonePageHeader
        title={t('title')}
        subtitle={t('info')}
        actions={
          <>
            {searchToggle.button}
            {!readOnly && (
              <>
                <PhoneIconButton
                  label={t('phone.moreActionsImport')}
                  aria-haspopup="dialog"
                  onClick={() => setMoreOpen(true)}
                >
                  <MoreHorizontal aria-hidden="true" />
                </PhoneIconButton>
                <PhoneIconButton label={t('actions.newContract')} variant="ink" onClick={onAdd}>
                  <Plus aria-hidden="true" />
                </PhoneIconButton>
              </>
            )}
          </>
        }
      >
        {searchToggle.open && (
          <PhoneSearchField
            inputRef={searchToggle.inputRef}
            value={search}
            onChange={onSearchChange}
            placeholder={t('actions.search')}
          />
        )}
      </PhonePageHeader>

      <ChipRow aria-label={t('form.status')} className="phone-crud-block">
        {FILTER_VALUES.map((f) => (
          <Chip
            key={f}
            label={f === 'todos' ? t('filter.all') : t(`status.${f}`)}
            selected={filter === f}
            onClick={() => onFilterChange(f)}
          />
        ))}
      </ChipRow>

      {isLoading ? (
        <CardListSkeleton />
      ) : contratos.length === 0 ? (
        <p className="phone-crud-empty">{t('phone.empty')}</p>
      ) : (
        <GroupedList aria-label={t('title')}>
          {contratos.map((c) => {
            const { swipe, menu } = actionsFor(c);
            const status = c.status in STATUS_TONE ? c.status : null;
            return (
              <PhoneCrudRow
                key={c.id ?? c.titulo}
                title={c.titulo}
                strongTitle
                subtitle={c.cliente_nome || undefined}
                meta={`${formatDate(c.data_inicio)} → ${formatDate(c.data_fim)}`}
                aside={
                  <>
                    <span className="phone-crud-amount">
                      {formatFinancialBRL(c.valor_total, canSeeValues)}
                    </span>
                    {status && (
                      <PhoneStatusPill tone={STATUS_TONE[status]}>
                        {t(`status.${status}`)}
                      </PhoneStatusPill>
                    )}
                  </>
                }
                chevron={!readOnly || Boolean(c.cliente_id)}
                onOpen={
                  readOnly
                    ? c.cliente_id
                      ? () => onOpenCliente(c.cliente_id!)
                      : undefined
                    : () => onEdit(c)
                }
                swipeActions={swipe}
                menuLabel={t('phone.actionsOf', { title: c.titulo })}
                menuSections={menu}
              />
            );
          })}
        </GroupedList>
      )}

      <ActionSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t('phone.moreActions')}
        message={contratosCsvHelp()}
        actions={[
          {
            label: t('actions.importCsv'),
            icon: <Upload aria-hidden="true" />,
            // The file picker needs the tap itself (iOS Safari blocks a deferred click).
            immediate: true,
            onSelect: onImport,
          },
        ]}
      />
    </div>
  );
}
