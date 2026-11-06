import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
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
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { type Membro } from '../../../store';

export type EquipeFilter = 'todos' | 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
export type EquipeSort = 'nome' | 'custo_maior' | 'custo_menor';

/** Display label of a membro tipo, resolved at call time in the current UI language. */
export function tipoLabel(tipo: string): string {
  return i18n.t(`team:shared.tipo.${tipo}`, { defaultValue: tipo });
}

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
  const { t } = useTranslation('team');
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const searchToggle = usePhoneSearch(search, onSearchChange);
  const activeFilters = (filter !== 'todos' ? 1 : 0) + (sort !== 'nome' ? 1 : 0);

  const sortOptions: { value: EquipeSort; label: string }[] = [
    { value: 'nome', label: t('shared.sortName') },
    ...(canSeeFinancials === true
      ? [
          { value: 'custo_maior' as const, label: t('shared.sortCostDesc') },
          { value: 'custo_menor' as const, label: t('shared.sortCostAsc') },
        ]
      : []),
  ];

  const actionsFor = (m: Membro): { swipe?: SwipeAction[]; menu: ContextMenuAction[][] } => {
    const open: ContextMenuAction = {
      label: t('equipePhone.viewMember'),
      icon: <UserRound aria-hidden="true" />,
      onSelect: () => onOpen(m),
    };
    if (!canEditTeam) return { menu: [[open]] };
    const swipe: SwipeAction[] = [
      { label: t('actions.edit'), icon: <Edit2 aria-hidden="true" />, onAction: () => onEdit(m) },
    ];
    const menu: ContextMenuAction[][] = [
      [
        open,
        { label: t('actions.edit'), icon: <Edit2 aria-hidden="true" />, onSelect: () => onEdit(m) },
      ],
    ];
    if (m.id) {
      const id = m.id;
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

  return (
    <div className="phone-crud-page">
      <PhonePageHeader
        title={t('shared.title')}
        actions={
          <>
            {searchToggle.button}
            <PhoneIconButton
              ref={filtersRef}
              label={
                activeFilters > 0
                  ? t('equipePhone.filtersLabelActive', { n: activeFilters })
                  : t('equipePhone.filtersLabel')
              }
              badge={activeFilters}
              aria-haspopup="dialog"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            {canEditTeam && (
              <PhoneIconButton
                label={t('equipePhone.addLabel')}
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
            placeholder={canEditTeam ? t('shared.searchEditor') : t('shared.searchViewer')}
          />
        )}
      </PhonePageHeader>

      {!canEditTeam && (
        <div className="phone-crud-notice">
          <RoleRestrictionNotice
            title={t('shared.restrictedTitle')}
            description={t('shared.restrictedDescription')}
          />
        </div>
      )}

      <StatCardGrid>
        <StatCard
          label={t('shared.totalMembers')}
          value={totalMembros}
          icon={UsersRound}
          tone="blue"
        />
        {canSeeFinancials === true && (
          <StatCard
            label={t('shared.totalCost')}
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
          <p className="phone-crud-empty">{t('shared.noMembers')}</p>
          <p className="phone-crud-help">{t('equipePhone.help')}</p>
        </>
      ) : (
        <GroupedList aria-label={t('equipePhone.membersAria')} footer={t('equipePhone.help')}>
          {membros.map((m) => {
            const { swipe, menu } = actionsFor(m);
            const badge =
              canEditTeam && !m.crm_user_id ? (
                m.id != null && pendingInviteIds.has(m.id) ? (
                  <PhoneStatusPill tone="warning">{t('shared.pendingInvite')}</PhoneStatusPill>
                ) : (
                  <PhoneStatusPill tone="outline">{t('shared.noLinkedAccount')}</PhoneStatusPill>
                )
              ) : null;
            return (
              <PhoneCrudRow
                key={m.id ?? m.nome}
                leading={
                  <PessoaAvatar
                    nome={m.nome}
                    fotoUrl={m.avatar_url}
                    seed={m.id}
                    className="phone-crud-avatar"
                  />
                }
                title={m.nome}
                subtitle={[m.cargo, tipoLabel(m.tipo)].filter(Boolean).join(' · ')}
                aside={badge}
                chevron
                onOpen={m.id ? () => onOpen(m) : undefined}
                swipeActions={swipe}
                menuLabel={t('equipePhone.rowActions', { name: m.nome })}
                menuSections={menu}
              />
            );
          })}
        </GroupedList>
      )}

      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description={t('equipePhone.filtersDescription')}
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
            label: t('shared.filterType'),
            chips: (['todos', 'clt', 'freelancer_mensal', 'freelancer_demanda'] as const).map(
              (f) => ({
                key: f,
                label: f === 'todos' ? t('shared.filterAll') : tipoLabel(f),
                selected: filter === f,
                onToggle: () => onFilterChange(f),
              }),
            ),
          },
          {
            type: 'chips',
            key: 'ordenar',
            label: t('equipePhone.sortBy'),
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
          title={t('equipePhone.addTitle')}
          message={t('shared.csvHelp')}
          actions={[
            {
              label: t('shared.addMember'),
              icon: <UserPlus aria-hidden="true" />,
              onSelect: onAdd,
            },
            {
              label: t('shared.importCsv'),
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
