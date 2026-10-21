import { useRef, useState } from 'react';
import {
  Edit2,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { GroupedList } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PhoneFiltersSheet } from '@/components/mobile/PhoneFiltersSheet';
import type { SwipeAction } from '@/components/mobile/SwipeRow';
import type { ContextMenuAction } from '@/components/mobile/ContextMenu';
import { PhoneCrudRow, PhoneStatusPill } from '@/components/phone-crud/PhoneCrudRow';
import { PhoneSearchField, usePhoneSearch } from '@/components/phone-crud/PhoneSearchField';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { CardListSkeleton } from '@/components/ui/skeletons';
import { avatarColorClass } from '@/lib/avatarColor';
import { cn } from '@/lib/utils';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { getInitials, type Membro } from '../../../store';

export type EquipeFilter = 'todos' | 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
export type EquipeSort = 'nome' | 'custo_maior' | 'custo_menor';

export const TIPO_LABEL: Record<string, string> = {
  clt: 'CLT',
  freelancer_mensal: 'Freelancer Mensal',
  freelancer_demanda: 'Freelancer Demanda',
};

/** Same copy as the desktop CSV tooltip. */
export const EQUIPE_CSV_HELP =
  'Colunas CSV: nome*, cargo*, tipo (clt|freelancer_mensal|freelancer_demanda), custo_mensal, data_pagamento';

/** The desktop "Membros vs Usuários" tooltip, as visible footnote text (D29). */
export const EQUIPE_HELP =
  'Membros são as pessoas da equipe (designers, redatores, etc.): servem para custos e atribuição de tarefas em fluxos. Usuários do workspace são contas com acesso ao CRM, geridas em Configurações → Workspace. Para que um membro acesse o CRM, vincule-o a um usuário do workspace no formulário de edição.';

export interface EquipePhoneProps {
  isLoading: boolean;
  membros: Membro[];
  totalMembros: number;
  totalCost: number;
  canSeeFinancials: FinancialAccess;
  canEditTeam: boolean;
  pendingInviteIds: Set<number>;
  filter: EquipeFilter;
  onFilterChange: (filter: EquipeFilter) => void;
  sort: EquipeSort;
  onSortChange: (sort: EquipeSort) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onOpen: (m: Membro) => void;
  onEdit: (m: Membro) => void;
  onDelete: (id: number) => void;
}

/**
 * Equipe below 768px (FEquipe mockup): page header with search, filters and the ink "+"
 * (editors), KPI tiles, one row per member with the link badges, and the Membros vs
 * Usuários explanation as the list footnote. Rows open the member; editors swipe or
 * long-press to edit and remove.
 */
export function EquipePhone({
  isLoading,
  membros,
  totalMembros,
  totalCost,
  canSeeFinancials,
  canEditTeam,
  pendingInviteIds,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onAdd,
  onImport,
  onOpen,
  onEdit,
  onDelete,
}: EquipePhoneProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const searchToggle = usePhoneSearch(search, onSearchChange);
  const activeFilters = (filter !== 'todos' ? 1 : 0) + (sort !== 'nome' ? 1 : 0);

  const sortOptions: { value: EquipeSort; label: string }[] = [
    { value: 'nome', label: 'Nome' },
    ...(canSeeFinancials === true
      ? [
          { value: 'custo_maior' as const, label: 'Custo (maior)' },
          { value: 'custo_menor' as const, label: 'Custo (menor)' },
        ]
      : []),
  ];

  const actionsFor = (m: Membro): { swipe?: SwipeAction[]; menu: ContextMenuAction[][] } => {
    const open: ContextMenuAction = {
      label: 'Ver membro',
      icon: <UserRound aria-hidden="true" />,
      onSelect: () => onOpen(m),
    };
    if (!canEditTeam) return { menu: [[open]] };
    const swipe: SwipeAction[] = [
      { label: 'Editar', icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(m) },
    ];
    const menu: ContextMenuAction[][] = [
      [open, { label: 'Editar', icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(m) }],
    ];
    if (m.id) {
      const id = m.id;
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
        title="Equipe"
        actions={
          <>
            {searchToggle.button}
            <PhoneIconButton
              ref={filtersRef}
              label={
                activeFilters > 0
                  ? `Filtros: Tipo e Ordenar por, ${activeFilters} ativos`
                  : 'Filtros: Tipo e Ordenar por'
              }
              badge={activeFilters}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {canEditTeam && (
              <PhoneIconButton
                label="Adicionar: Adicionar Membro ou Importar CSV"
                variant="ink"
                aria-haspopup="dialog"
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        {searchToggle.open && (
          <PhoneSearchField
            inputRef={searchToggle.inputRef}
            value={search}
            onChange={onSearchChange}
            placeholder={
              canEditTeam ? 'Buscar por nome, cargo ou e-mail...' : 'Buscar por nome ou cargo...'
            }
          />
        )}
      </PhonePageHeader>

      {!canEditTeam && (
        <div className="phone-crud-notice">
          <RoleRestrictionNotice
            title="Visualização limitada"
            description="Apenas administradores e proprietários podem adicionar, editar ou remover membros da equipe."
          />
        </div>
      )}

      <StatCardGrid>
        <StatCard label="Total de membros" value={totalMembros} icon={UsersRound} tone="blue" />
        {canSeeFinancials === true && (
          <StatCard
            label="Custo mensal total"
            value={formatFinancialBRL(totalCost, canSeeFinancials)}
            icon={Wallet}
            tone="violet"
            compactValue
          />
        )}
      </StatCardGrid>

      {isLoading ? (
        <CardListSkeleton />
      ) : membros.length === 0 ? (
        <>
          <p className="phone-crud-empty">Nenhum membro encontrado.</p>
          <p className="phone-crud-help">{EQUIPE_HELP}</p>
        </>
      ) : (
        <GroupedList aria-label="Membros" footer={EQUIPE_HELP}>
          {membros.map((m) => {
            const { swipe, menu } = actionsFor(m);
            const badge =
              canEditTeam && !m.crm_user_id ? (
                m.id != null && pendingInviteIds.has(m.id) ? (
                  <PhoneStatusPill tone="warning">convite pendente</PhoneStatusPill>
                ) : (
                  <PhoneStatusPill tone="outline">sem conta vinculada</PhoneStatusPill>
                )
              ) : null;
            return (
              <PhoneCrudRow
                key={m.id ?? m.nome}
                leading={
                  <span
                    className={cn('avatar phone-crud-avatar', avatarColorClass(m.id ?? m.nome))}
                    aria-hidden="true"
                  >
                    {getInitials(m.nome)}
                  </span>
                }
                title={m.nome}
                subtitle={[m.cargo, TIPO_LABEL[m.tipo]].filter(Boolean).join(' · ')}
                aside={badge}
                chevron
                onOpen={m.id ? () => onOpen(m) : undefined}
                swipeActions={swipe}
                menuLabel={`Ações de ${m.nome}`}
                menuSections={menu}
              />
            );
          })}
        </GroupedList>
      )}

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Filtre e ordene a equipe"
        returnFocusRef={filtersRef}
        activeCount={activeFilters}
        resultCount={membros.length}
        onClear={() => {
          onFilterChange('todos');
          onSortChange('nome');
        }}
        sections={[
          {
            type: 'chips',
            key: 'tipo',
            label: 'Tipo',
            chips: (['todos', 'clt', 'freelancer_mensal', 'freelancer_demanda'] as const).map(
              (f) => ({
                key: f,
                label: f === 'todos' ? 'Todos' : TIPO_LABEL[f],
                selected: filter === f,
                onToggle: () => onFilterChange(f),
              }),
            ),
          },
          {
            type: 'chips',
            key: 'ordenar',
            label: 'Ordenar por',
            chips: sortOptions.map((o) => ({
              key: o.value,
              label: o.label,
              selected: sort === o.value,
              onToggle: () => onSortChange(o.value),
            })),
          },
        ]}
      />

      {canEditTeam && (
        <ActionSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          title="Adicionar"
          message={EQUIPE_CSV_HELP}
          actions={[
            {
              label: 'Adicionar Membro',
              icon: <UserPlus aria-hidden="true" />,
              onSelect: onAdd,
            },
            {
              label: 'Importar CSV',
              icon: <Upload aria-hidden="true" />,
              // The file picker needs the tap itself (iOS Safari blocks a deferred click).
              immediate: true,
              onSelect: onImport,
            },
          ]}
        />
      )}
    </div>
  );
}
