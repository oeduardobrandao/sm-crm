import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
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
    list.find((x) => x.id === id)?.nome ?? i18n.t('entregasPhone:filters.noName');
  /** `group` is a stable id: the chip key uses it, the remove label its translation. */
  const push = (group: string, key: string, label: string, next: FilterState) =>
    chips.push({
      key: `${group}:${key}`,
      label,
      removeLabel: i18n.t('entregasPhone:filters.removeChip', {
        group: i18n.t(`entregasPhone:filters.groups.${group}`),
        label,
      }),
      next,
    });

  if (mode === 'entregas')
    for (const s of filters.filterStatus) {
      const label = STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
      push('status', s, label, { ...filters, filterStatus: without(filters.filterStatus, s) });
    }
  for (const p of filters.filterPrazo)
    push('prazo', p, PRAZO_PRESET_LABELS[p], {
      ...filters,
      filterPrazo: without(filters.filterPrazo, p),
    });
  if (filters.filterPrazoFrom || filters.filterPrazoTo) {
    const fmt = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
    const label = [
      filters.filterPrazoFrom &&
        i18n.t('entregasPhone:filters.rangeFrom', { date: fmt(filters.filterPrazoFrom) }),
      filters.filterPrazoTo &&
        i18n.t('entregasPhone:filters.rangeTo', { date: fmt(filters.filterPrazoTo) }),
    ]
      .filter(Boolean)
      .join(' ');
    push('prazo', 'range', label, { ...filters, filterPrazoFrom: '', filterPrazoTo: '' });
  }
  for (const id of filters.filterClientes)
    push('cliente', String(id), nameOf(clientes, id), {
      ...filters,
      filterClientes: without(filters.filterClientes, id),
    });
  if (mode === 'posts')
    for (const k of filters.filterPostStatus)
      push('postStatus', k, registry.byKey.get(k)?.label ?? k, {
        ...filters,
        filterPostStatus: without(filters.filterPostStatus, k),
      });
  for (const id of filters.filterMembros)
    push('responsavel', String(id), nameOf(membros, id), {
      ...filters,
      filterMembros: without(filters.filterMembros, id),
    });
  if (mode === 'entregas')
    for (const id of filters.filterPostResponsaveis)
      push('postResponsavel', String(id), nameOf(membros, id), {
        ...filters,
        filterPostResponsaveis: without(filters.filterPostResponsaveis, id),
      });
  for (const e of filters.filterEtapas)
    push('etapa', e, e, { ...filters, filterEtapas: without(filters.filterEtapas, e) });
  if (mode === 'entregas')
    for (const id of filters.filterTemplates)
      push('template', String(id), nameOf(templates, id), {
        ...filters,
        filterTemplates: without(filters.filterTemplates, id),
      });
  if (mode === 'posts')
    for (const tipo of filters.filterTipos)
      push('tipo', tipo, TIPO_LABELS[tipo], {
        ...filters,
        filterTipos: without(filters.filterTipos, tipo),
      });
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
  const { t } = useTranslation('entregasPhone');
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
      title: t('filters.groups.cliente'),
      allLabel: t('filters.allMasc'),
      options: clienteOptions,
      selected: filters.filterClientes,
      onChange: (v) => onChange({ ...filters, filterClientes: v as number[] }),
    },
    membros: {
      key: 'membros',
      title: t('filters.groups.responsavel'),
      allLabel: t('filters.allMasc'),
      options: membroOptions,
      selected: filters.filterMembros,
      onChange: (v) => onChange({ ...filters, filterMembros: v as number[] }),
    },
    postResponsaveis: {
      key: 'postResponsaveis',
      title: t('filters.groups.postResponsavel'),
      allLabel: t('filters.allMasc'),
      options: membroOptions,
      selected: filters.filterPostResponsaveis,
      onChange: (v) => onChange({ ...filters, filterPostResponsaveis: v as number[] }),
    },
    etapas: {
      key: 'etapas',
      title: t('filters.groups.etapa'),
      allLabel: t('filters.allFem'),
      options: [...etapaNames]
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({ value: n, label: n })),
      selected: filters.filterEtapas,
      onChange: (v) => onChange({ ...filters, filterEtapas: v as string[] }),
    },
    templates: {
      key: 'templates',
      title: t('filters.groups.template'),
      allLabel: t('filters.allMasc'),
      options: [...templates]
        .filter((tpl) => tpl.id != null)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((tpl) => ({ value: tpl.id!, label: tpl.nome })),
      selected: filters.filterTemplates,
      onChange: (v) => onChange({ ...filters, filterTemplates: v as number[] }),
    },
    postStatus: {
      key: 'postStatus',
      title: t('filters.groups.postStatus'),
      allLabel: t('filters.allMasc'),
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
      label: t('filters.situacao'),
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
    label: t('shared.stageDeadline'),
    chips: [
      ...PRAZO_PRESET_ORDER.map((p) => ({
        key: p,
        label: PRAZO_PRESET_LABELS[p],
        selected: filters.filterPrazo.includes(p),
        onToggle: () => onChange({ ...filters, filterPrazo: toggle(filters.filterPrazo, p) }),
      })),
      {
        key: 'personalizado',
        label: t('filters.custom'),
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
          {t('filters.from')}
          <input
            type="date"
            value={filters.filterPrazoFrom}
            onChange={(e) => onChange({ ...filters, filterPrazoFrom: e.target.value })}
          />
        </label>
        <label>
          {t('filters.to')}
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
      label: t('filters.groups.tipo'),
      chips: TIPO_ORDER.map((tipo) => ({
        key: tipo,
        label: TIPO_LABELS[tipo],
        selected: filters.filterTipos.includes(tipo),
        onToggle: () => onChange({ ...filters, filterTipos: toggle(filters.filterTipos, tipo) }),
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
      title={t('header.filters')}
      description={isPosts ? t('filters.descriptionPosts') : t('filters.descriptionFluxos')}
      sections={sections}
      activeCount={countActiveFilters(filters, mode)}
      onClear={() => onChange(clearedFilters(filters))}
      resultCount={resultCount}
      returnFocusRef={returnFocusRef}
    />
  );
}
