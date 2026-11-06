import { useState } from 'react';
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

/** Same copy as the desktop CSV tooltip. */
export const CONTRATOS_CSV_HELP =
  'Colunas: titulo*, cliente_nome, data_inicio* (AAAA-MM-DD), data_fim*, valor_total*, status';

const FILTERS: { value: ContratosFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'vigente', label: 'Vigente' },
  { value: 'a_assinar', label: 'A Assinar' },
  { value: 'encerrado', label: 'Encerrado' },
];

const STATUS: Record<
  Contrato['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' }
> = {
  vigente: { label: 'Vigente', tone: 'success' },
  a_assinar: { label: 'A Assinar', tone: 'warning' },
  encerrado: { label: 'Encerrado', tone: 'neutral' },
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
}: ContratosPhoneProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const searchToggle = usePhoneSearch(search, onSearchChange);

  const actionsFor = (c: Contrato): { swipe: SwipeAction[]; menu: ContextMenuAction[][] } => {
    const swipe: SwipeAction[] = [
      { label: 'Editar', icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(c) },
    ];
    const menu: ContextMenuAction[][] = [
      [{ label: 'Editar', icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(c) }],
    ];
    if (c.cliente_id) {
      const clienteId = c.cliente_id;
      menu[0].push({
        label: 'Abrir cliente',
        icon: <UserRound aria-hidden="true" />,
        onSelect: () => onOpenCliente(clienteId),
      });
    }
    if (c.id) {
      const id = c.id;
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

  return (
    <div className="phone-crud-page">
      <PhonePageHeader
        title="Contratos"
        subtitle="Gerencie os contratos dos seus clientes."
        actions={
          <>
            {searchToggle.button}
            <PhoneIconButton
              label="Mais ações: Importar CSV"
              aria-haspopup="dialog"
              onClick={() => setMoreOpen(true)}
            >
              <MoreHorizontal aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton label="Novo Contrato" variant="ink" onClick={onAdd}>
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
            placeholder="Buscar por título ou cliente..."
          />
        )}
      </PhonePageHeader>

      <ChipRow aria-label="Status" className="phone-crud-block">
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            selected={filter === f.value}
            onClick={() => onFilterChange(f.value)}
          />
        ))}
      </ChipRow>

      {isLoading ? (
        <CardListSkeleton />
      ) : contratos.length === 0 ? (
        <p className="phone-crud-empty">Nenhum contrato encontrado.</p>
      ) : (
        <GroupedList aria-label="Contratos">
          {contratos.map((c) => {
            const { swipe, menu } = actionsFor(c);
            const status = STATUS[c.status];
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
                    {status && <PhoneStatusPill tone={status.tone}>{status.label}</PhoneStatusPill>}
                  </>
                }
                chevron
                onOpen={() => onEdit(c)}
                swipeActions={swipe}
                menuLabel={`Ações de ${c.titulo}`}
                menuSections={menu}
              />
            );
          })}
        </GroupedList>
      )}

      <ActionSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="Mais ações"
        message={CONTRATOS_CSV_HELP}
        actions={[
          {
            label: 'Importar CSV',
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
