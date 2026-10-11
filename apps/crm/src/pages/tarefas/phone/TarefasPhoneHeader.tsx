import { useRef, useState, type ReactNode } from 'react';
import {
  Calendar,
  ChevronDown,
  Columns,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneFiltersSheet, type FilterSection } from '@/components/mobile/PhoneFiltersSheet';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { Cliente, Membro, TarefaStatus, TarefaTag } from '../../../store';
import {
  EMPTY_TAREFA_FILTERS,
  STATUS_LABELS,
  STATUS_ORDER,
  type TarefaFilterState,
  type TarefasHeaderStats,
} from '../tarefasLogic';
import type { TarefasEscopo } from '../tarefasPrefs';
import './tarefasPhone.css';

export type TarefasView = 'lista' | 'membros' | 'kanban' | 'calendario';

export const PHONE_TAREFA_VIEWS: { id: TarefasView; label: string; icon: ReactNode }[] = [
  { id: 'lista', label: 'Lista', icon: <List aria-hidden="true" /> },
  { id: 'membros', label: 'Por membro', icon: <Users aria-hidden="true" /> },
  { id: 'kanban', label: 'Kanban', icon: <Columns aria-hidden="true" /> },
  { id: 'calendario', label: 'Calendário', icon: <Calendar aria-hidden="true" /> },
];

export interface TarefasPhoneHeaderProps {
  stats: TarefasHeaderStats;
  view: TarefasView;
  onViewChange: (view: TarefasView) => void;
  /** Null when the user has no linked membro: no Minhas/Todas then (desktop rule). */
  escopo: TarefasEscopo | null;
  onEscopoChange: (escopo: TarefasEscopo) => void;
  filters: TarefaFilterState;
  onFiltersChange: (filters: TarefaFilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
  tags: TarefaTag[];
  /** Tasks shown with the current filters ("Ver N" in the sheet). */
  resultCount: number;
  onNew: () => void;
}

function countActive(f: TarefaFilterState): number {
  return [f.filterMembros, f.filterClientes, f.filterTags, f.filterStatus].filter(
    (v) => v.length > 0,
  ).length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tarefas header on phones (FTarefas / FTarefasKanban): one row with search, Filtros
 * (badge) and the ink "+", the large title with the counts, the view picker and
 * Minhas/Todas, and the active filter chips. Filters live in the kit sheet with the
 * same four multi-selects as the desktop bar.
 */
export function TarefasPhoneHeader({
  stats,
  view,
  onViewChange,
  escopo,
  onEscopoChange,
  filters,
  onFiltersChange,
  clientes,
  membros,
  tags,
  resultCount,
  onNew,
}: TarefasPhoneHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(filters.filterSearch !== '');
  const [viewsOpen, setViewsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const activeCount = countActive(filters);
  const current = PHONE_TAREFA_VIEWS.find((v) => v.id === view) ?? PHONE_TAREFA_VIEWS[0];

  const activeClientes = clientes
    .filter((c) => c.status === 'ativo' && c.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = membros
    .filter((m) => m.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedTags = tags.filter((t) => t.id != null).sort((a, b) => a.nome.localeCompare(b.nome));

  const set = (patch: Partial<TarefaFilterState>) => onFiltersChange({ ...filters, ...patch });
  const clear = () =>
    onFiltersChange({ ...EMPTY_TAREFA_FILTERS, filterSearch: filters.filterSearch });

  const toggleStatus = (s: TarefaStatus) =>
    set({
      filterStatus: filters.filterStatus.includes(s)
        ? filters.filterStatus.filter((v) => v !== s)
        : [...filters.filterStatus, s],
    });

  const sections: FilterSection[] = [
    {
      type: 'chips',
      key: 'status',
      label: 'Status',
      chips: STATUS_ORDER.map((s) => ({
        key: s,
        label: STATUS_LABELS[s],
        selected: filters.filterStatus.includes(s),
        onToggle: () => toggleStatus(s),
      })),
    },
    {
      type: 'lists',
      key: 'lists',
      lists: [
        {
          key: 'membros',
          title: 'Membros',
          allLabel: 'Todos',
          options: sortedMembros.map((m) => ({ value: m.id!, label: m.nome })),
          selected: filters.filterMembros,
          onChange: (next) => set({ filterMembros: next as number[] }),
        },
        {
          key: 'clientes',
          title: 'Clientes',
          allLabel: 'Todos',
          options: activeClientes.map((c) => ({ value: c.id!, label: c.nome })),
          selected: filters.filterClientes,
          onChange: (next) => set({ filterClientes: next as number[] }),
        },
        {
          key: 'tags',
          title: 'Tags',
          allLabel: 'Todas',
          options: sortedTags.map((t) => ({ value: t.id!, label: t.nome })),
          selected: filters.filterTags,
          onChange: (next) => set({ filterTags: next as number[] }),
        },
      ],
    },
  ];

  // Active filter chips: one removable chip per picked value.
  const chips: { key: string; label: string; group: string; remove: () => void }[] = [
    ...filters.filterStatus.map((s) => ({
      key: `s-${s}`,
      label: STATUS_LABELS[s],
      group: 'Status',
      remove: () => toggleStatus(s),
    })),
    ...filters.filterMembros.map((id) => ({
      key: `m-${id}`,
      label: membros.find((m) => m.id === id)?.nome ?? 'Membro',
      group: 'Membro',
      remove: () => set({ filterMembros: filters.filterMembros.filter((v) => v !== id) }),
    })),
    ...filters.filterClientes.map((id) => ({
      key: `c-${id}`,
      label: clientes.find((c) => c.id === id)?.nome ?? 'Cliente',
      group: 'Cliente',
      remove: () => set({ filterClientes: filters.filterClientes.filter((v) => v !== id) }),
    })),
    ...filters.filterTags.map((id) => ({
      key: `t-${id}`,
      label: tags.find((t) => t.id === id)?.nome ?? 'Tag',
      group: 'Tag',
      remove: () => set({ filterTags: filters.filterTags.filter((v) => v !== id) }),
    })),
  ];

  const subtitle = (
    <>
      {plural(stats.abertas, 'aberta', 'abertas')}
      {stats.atrasadas > 0 && (
        <span className="phone-tar-subtitle__overdue">
          {' · '}
          {plural(stats.atrasadas, 'atrasada', 'atrasadas')}
        </span>
      )}
      {stats.vencemHoje > 0 && (
        <span className="phone-tar-subtitle__today">
          {' · '}
          {stats.vencemHoje} vence{stats.vencemHoje === 1 ? '' : 'm'} hoje
        </span>
      )}
      {stats.concluidasHoje > 0 && (
        <>
          {' · '}
          {plural(stats.concluidasHoje, 'concluída hoje', 'concluídas hoje')}
        </>
      )}
    </>
  );

  return (
    <>
      <PhonePageHeader
        title="Tarefas"
        subtitle={subtitle}
        actions={
          <>
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : 'Buscar'}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  set({ filterSearch: '' });
                  setSearchOpen(false);
                } else {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }
              }}
            >
              {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
            </PhoneIconButton>
            <PhoneIconButton
              ref={filtersRef}
              label={
                activeCount > 0
                  ? `Filtros, ${activeCount} ${activeCount === 1 ? 'ativo' : 'ativos'}`
                  : 'Filtros'
              }
              badge={activeCount}
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton label="Nova tarefa" variant="ink" onClick={onNew}>
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      >
        {searchOpen && (
          <div className="phone-tar-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              aria-label="Buscar tarefa"
              placeholder="Buscar tarefa..."
              value={filters.filterSearch}
              onChange={(e) => set({ filterSearch: e.target.value })}
            />
          </div>
        )}
        <div className="phone-tar-row">
          <button
            ref={viewRef}
            type="button"
            className="phone-tar-view"
            aria-haspopup="dialog"
            aria-label={`Visualização: ${current.label}. Trocar visualização`}
            onClick={() => setViewsOpen(true)}
          >
            {current.icon}
            {current.label}
            <ChevronDown className="phone-tar-view__chevron" aria-hidden="true" />
          </button>
          {escopo && (
            <SegmentedControl
              aria-label="Escopo"
              className="phone-tar-escopo"
              value={escopo}
              onChange={onEscopoChange}
              options={[
                { value: 'minhas', label: 'Minhas' },
                { value: 'todas', label: 'Todas' },
              ]}
            />
          )}
        </div>
        {chips.length > 0 && (
          <ChipRow aria-label="Filtros ativos" className="phone-tar-chips">
            {chips.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                removeLabel={`Remover filtro ${c.group}: ${c.label}`}
                onRemove={c.remove}
              />
            ))}
            <button type="button" className="phone-tar-text-btn" onClick={clear}>
              Limpar filtros
            </button>
          </ChipRow>
        )}
      </PhonePageHeader>

      <ActionSheet
        open={viewsOpen}
        onOpenChange={setViewsOpen}
        title="Visualização"
        returnFocusRef={viewRef}
        actions={PHONE_TAREFA_VIEWS.map((v) => ({
          label: v.id === view ? `✓ ${v.label}` : v.label,
          icon: v.icon,
          onSelect: () => onViewChange(v.id),
        }))}
      />
      <PhoneFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Filtre as tarefas"
        sections={sections}
        activeCount={activeCount}
        onClear={clear}
        resultCount={resultCount}
        returnFocusRef={filtersRef}
      />
    </>
  );
}
