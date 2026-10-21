import { useState } from 'react';
import {
  PhoneFiltersSheet as FiltersSheetShell,
  type FilterList,
  type FilterSection,
} from '@/components/mobile/PhoneFiltersSheet';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import {
  EMPTY_FILTERS,
  STATUS_OPTIONS,
  countActiveFilters,
  type FilterState,
  type FiltersMode,
} from '../components/EntregasFilters';
import { PRAZO_PRESET_LABELS, PRAZO_PRESET_ORDER } from '../etapaPrazo';
import { TIPO_LABELS, TIPO_ORDER } from '../postLabels';
import type { StatusRegistry } from '../statusRegistry';
import './entregasPhone.css';

interface Lookups {
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  etapaNames: string[];
}

export interface FilterChip {
  key: string;
  label: string;
  removeLabel: string;
  next: FilterState;
}

function without<T>(list: T[], value: T): T[] {
  return list.filter((v) => v !== value);
}

/**
 * One removable chip per active value, in the order the filters sheet lists them
 * (EntregasKanban mockup: "Café Aurora ×", "Atrasados ×"). Only the filters the
 * mode applies, same split as the desktop pills.
 */
export function activeFilterChips(
  filters: FilterState,
  mode: FiltersMode,
  { clientes, membros, templates }: Omit<Lookups, 'etapaNames'>,
  registry: StatusRegistry,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const nameOf = <T extends { id?: number; nome: string }>(list: T[], id: number) =>
    list.find((x) => x.id === id)?.nome ?? 'Sem nome';
  const push = (group: string, key: string, label: string, next: FilterState) =>
    chips.push({
      key: `${group}:${key}`,
      label,
      removeLabel: `Remover filtro ${group}: ${label}`,
      next,
    });

  if (mode === 'entregas')
    for (const s of filters.filterStatus) {
      const label = STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
      push('Status', s, label, { ...filters, filterStatus: without(filters.filterStatus, s) });
    }
  for (const p of filters.filterPrazo)
    push('Prazo', p, PRAZO_PRESET_LABELS[p], {
      ...filters,
      filterPrazo: without(filters.filterPrazo, p),
    });
  if (filters.filterPrazoFrom || filters.filterPrazoTo) {
    const fmt = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
    const label = [
      filters.filterPrazoFrom && `de ${fmt(filters.filterPrazoFrom)}`,
      filters.filterPrazoTo && `até ${fmt(filters.filterPrazoTo)}`,
    ]
      .filter(Boolean)
      .join(' ');
    push('Prazo', 'range', label, { ...filters, filterPrazoFrom: '', filterPrazoTo: '' });
  }
  for (const id of filters.filterClientes)
    push('Cliente', String(id), nameOf(clientes, id), {
      ...filters,
      filterClientes: without(filters.filterClientes, id),
    });
  if (mode === 'posts')
    for (const k of filters.filterPostStatus)
      push('Status do post', k, registry.byKey.get(k)?.label ?? k, {
        ...filters,
        filterPostStatus: without(filters.filterPostStatus, k),
      });
  for (const id of filters.filterMembros)
    push('Responsável', String(id), nameOf(membros, id), {
      ...filters,
      filterMembros: without(filters.filterMembros, id),
    });
  if (mode === 'entregas')
    for (const id of filters.filterPostResponsaveis)
      push('Responsável do post', String(id), nameOf(membros, id), {
        ...filters,
        filterPostResponsaveis: without(filters.filterPostResponsaveis, id),
      });
  for (const e of filters.filterEtapas)
    push('Etapa', e, e, { ...filters, filterEtapas: without(filters.filterEtapas, e) });
  if (mode === 'entregas')
    for (const id of filters.filterTemplates)
      push('Template', String(id), nameOf(templates, id), {
        ...filters,
        filterTemplates: without(filters.filterTemplates, id),
      });
  if (mode === 'posts')
    for (const t of filters.filterTipos)
      push('Tipo', t, TIPO_LABELS[t], { ...filters, filterTipos: without(filters.filterTipos, t) });
  return chips;
}

/** Clears every filter but keeps the search (same as the desktop "Limpar filtros"). */
export function clearedFilters(filters: FilterState): FilterState {
  return { ...EMPTY_FILTERS, filterSearch: filters.filterSearch };
}

export interface PhoneFiltersSheetProps extends Lookups {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  mode: FiltersMode;
  /** What the screen shows with the current filters ("Ver 6"). */
  resultCount: number;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Entregas' filters on phones (EntregasFiltros mockup), on the kit's filters sheet:
 * chip groups for the short lists (situação, prazo, tipo) and drill-in lists for the
 * long ones (cliente, responsáveis, etapa, template, status do post). Changes apply as
 * they're made, like the desktop pills, so "Ver N" is the real count.
 */
export function PhoneFiltersSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  mode,
  resultCount,
  clientes,
  membros,
  templates,
  etapaNames,
  returnFocusRef,
}: PhoneFiltersSheetProps) {
  const registry = useStatusRegistry();
  const hasRange = !!filters.filterPrazoFrom || !!filters.filterPrazoTo;
  // "Personalizado" is open while the sheet is, starting from whether a range is set
  // each time it opens (the sheet's content used to remount on open).
  const [customRange, setCustomRange] = useState(hasRange);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCustomRange(hasRange);
  }
  const isPosts = mode === 'posts';
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? without(list, value) : [...list, value];

  const clienteOptions = clientes
    .filter((c) => c.status === 'ativo' && c.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((c) => ({ value: c.id!, label: c.nome }));
  const membroOptions = [...membros]
    .filter((m) => m.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((m) => ({ value: m.id!, label: m.nome }));

  const lists = {
    clientes: {
      key: 'clientes',
      title: 'Cliente',
      allLabel: 'Todos',
      options: clienteOptions,
      selected: filters.filterClientes,
      onChange: (v) => onChange({ ...filters, filterClientes: v as number[] }),
    },
    membros: {
      key: 'membros',
      title: 'Responsável',
      allLabel: 'Todos',
      options: membroOptions,
      selected: filters.filterMembros,
      onChange: (v) => onChange({ ...filters, filterMembros: v as number[] }),
    },
    postResponsaveis: {
      key: 'postResponsaveis',
      title: 'Responsável do post',
      allLabel: 'Todos',
      options: membroOptions,
      selected: filters.filterPostResponsaveis,
      onChange: (v) => onChange({ ...filters, filterPostResponsaveis: v as number[] }),
    },
    etapas: {
      key: 'etapas',
      title: 'Etapa',
      allLabel: 'Todas',
      options: [...etapaNames]
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({ value: n, label: n })),
      selected: filters.filterEtapas,
      onChange: (v) => onChange({ ...filters, filterEtapas: v as string[] }),
    },
    templates: {
      key: 'templates',
      title: 'Template',
      allLabel: 'Todos',
      options: [...templates]
        .filter((t) => t.id != null)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((t) => ({ value: t.id!, label: t.nome })),
      selected: filters.filterTemplates,
      onChange: (v) => onChange({ ...filters, filterTemplates: v as number[] }),
    },
    postStatus: {
      key: 'postStatus',
      title: 'Status do post',
      allLabel: 'Todos',
      options: registry.options.map((o) => ({ value: o.key, label: o.label })),
      selected: filters.filterPostStatus,
      onChange: (v) =>
        onChange({ ...filters, filterPostStatus: v as FilterState['filterPostStatus'] }),
    },
  } satisfies Record<string, FilterList>;

  const sections: FilterSection[] = [];
  if (!isPosts)
    sections.push({
      type: 'chips',
      key: 'situacao',
      label: 'Situação',
      chips: STATUS_OPTIONS.map((o) => ({
        key: o.value,
        label: o.label,
        selected: filters.filterStatus.includes(o.value),
        onToggle: () =>
          onChange({ ...filters, filterStatus: toggle(filters.filterStatus, o.value) }),
      })),
    });
  sections.push({
    type: 'chips',
    key: 'prazo',
    label: 'Prazo da etapa',
    chips: [
      ...PRAZO_PRESET_ORDER.map((p) => ({
        key: p,
        label: PRAZO_PRESET_LABELS[p],
        selected: filters.filterPrazo.includes(p),
        onToggle: () => onChange({ ...filters, filterPrazo: toggle(filters.filterPrazo, p) }),
      })),
      {
        key: 'personalizado',
        label: 'Personalizado',
        selected: customRange,
        onToggle: () => {
          if (customRange) onChange({ ...filters, filterPrazoFrom: '', filterPrazoTo: '' });
          setCustomRange(!customRange);
        },
      },
    ],
    after: customRange && (
      <div className="phone-ent-filters__range">
        <label>
          De
          <input
            type="date"
            value={filters.filterPrazoFrom}
            onChange={(e) => onChange({ ...filters, filterPrazoFrom: e.target.value })}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={filters.filterPrazoTo}
            onChange={(e) => onChange({ ...filters, filterPrazoTo: e.target.value })}
          />
        </label>
      </div>
    ),
  });
  if (isPosts)
    sections.push({
      type: 'chips',
      key: 'tipo',
      label: 'Tipo',
      chips: TIPO_ORDER.map((t) => ({
        key: t,
        label: TIPO_LABELS[t],
        selected: filters.filterTipos.includes(t),
        onToggle: () => onChange({ ...filters, filterTipos: toggle(filters.filterTipos, t) }),
      })),
    });
  sections.push({
    type: 'lists',
    key: 'listas',
    lists: isPosts
      ? [lists.clientes, lists.postStatus, lists.membros, lists.etapas]
      : [lists.clientes, lists.membros, lists.postResponsaveis, lists.etapas, lists.templates],
  });

  return (
    <FiltersSheetShell
      open={open}
      onOpenChange={onOpenChange}
      title="Filtros"
      description={isPosts ? 'Filtre os posts' : 'Filtre os fluxos'}
      sections={sections}
      activeCount={countActiveFilters(filters, mode)}
      onClear={() => onChange(clearedFilters(filters))}
      resultCount={resultCount}
      returnFocusRef={returnFocusRef}
    />
  );
}
