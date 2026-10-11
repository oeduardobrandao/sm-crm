import { useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
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

type ListKey = 'clientes' | 'membros' | 'postResponsaveis' | 'etapas' | 'templates' | 'postStatus';

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
 * Filters on phones (EntregasFiltros mockup): a sheet with Limpar / Ver N, chip
 * groups for the short lists (situação, prazo, tipo) and drill-in lists for the
 * long ones (cliente, responsáveis, etapa, template, status do post). Changes
 * apply as they're made, like the desktop pills, so "Ver N" is the real count.
 */
export function PhoneFiltersSheet({
  open,
  onOpenChange,
  returnFocusRef,
  ...rest
}: PhoneFiltersSheetProps) {
  const [page, setPage] = useState<ListKey | null>(null);
  const handleOpenChange = (next: boolean) => {
    if (!next) setPage(null);
    onOpenChange(next);
  };
  const active = countActiveFilters(rest.filters, rest.mode);
  return (
    <BottomSheet
      open={open}
      onOpenChange={handleOpenChange}
      title="Filtros"
      description={rest.mode === 'posts' ? 'Filtre os posts' : 'Filtre os fluxos'}
      detents={['large']}
      returnFocusRef={returnFocusRef}
      headerLeading={
        page ? (
          <button type="button" className="phone-ent-text-btn" onClick={() => setPage(null)}>
            <ChevronLeft aria-hidden="true" />
            Filtros
          </button>
        ) : (
          <button
            type="button"
            className="phone-ent-text-btn"
            disabled={active === 0}
            onClick={() => rest.onChange(clearedFilters(rest.filters))}
          >
            Limpar
          </button>
        )
      }
      headerTrailing={
        <button
          type="button"
          className="phone-ent-text-btn phone-ent-text-btn--strong"
          onClick={() => handleOpenChange(false)}
        >
          Ver {rest.resultCount}
        </button>
      }
    >
      <FiltersBody {...rest} page={page} onPage={setPage} />
    </BottomSheet>
  );
}

function FiltersBody({
  filters,
  onChange,
  mode,
  clientes,
  membros,
  templates,
  etapaNames,
  page,
  onPage,
}: Omit<PhoneFiltersSheetProps, 'open' | 'onOpenChange' | 'resultCount' | 'returnFocusRef'> & {
  page: ListKey | null;
  onPage: (page: ListKey | null) => void;
}) {
  const registry = useStatusRegistry();
  const [customRange, setCustomRange] = useState(
    () => !!filters.filterPrazoFrom || !!filters.filterPrazoTo,
  );
  const isPosts = mode === 'posts';

  const clienteOptions = clientes
    .filter((c) => c.status === 'ativo' && c.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((c) => ({ value: c.id!, label: c.nome }));
  const membroOptions = [...membros]
    .filter((m) => m.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((m) => ({ value: m.id!, label: m.nome }));
  const lists: Record<
    ListKey,
    {
      title: string;
      allLabel: string;
      options: { value: string | number; label: string }[];
      selected: (string | number)[];
      set: (next: (string | number)[]) => void;
    }
  > = {
    clientes: {
      title: 'Cliente',
      allLabel: 'Todos',
      options: clienteOptions,
      selected: filters.filterClientes,
      set: (v) => onChange({ ...filters, filterClientes: v as number[] }),
    },
    membros: {
      title: 'Responsável',
      allLabel: 'Todos',
      options: membroOptions,
      selected: filters.filterMembros,
      set: (v) => onChange({ ...filters, filterMembros: v as number[] }),
    },
    postResponsaveis: {
      title: 'Responsável do post',
      allLabel: 'Todos',
      options: membroOptions,
      selected: filters.filterPostResponsaveis,
      set: (v) => onChange({ ...filters, filterPostResponsaveis: v as number[] }),
    },
    etapas: {
      title: 'Etapa',
      allLabel: 'Todas',
      options: [...etapaNames]
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({ value: n, label: n })),
      selected: filters.filterEtapas,
      set: (v) => onChange({ ...filters, filterEtapas: v as string[] }),
    },
    templates: {
      title: 'Template',
      allLabel: 'Todos',
      options: [...templates]
        .filter((t) => t.id != null)
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((t) => ({ value: t.id!, label: t.nome })),
      selected: filters.filterTemplates,
      set: (v) => onChange({ ...filters, filterTemplates: v as number[] }),
    },
    postStatus: {
      title: 'Status do post',
      allLabel: 'Todos',
      options: registry.options.map((o) => ({ value: o.key, label: o.label })),
      selected: filters.filterPostStatus,
      set: (v) => onChange({ ...filters, filterPostStatus: v as FilterState['filterPostStatus'] }),
    },
  };

  if (page) {
    const list = lists[page];
    const toggle = (value: string | number) =>
      list.set(
        list.selected.includes(value)
          ? list.selected.filter((v) => v !== value)
          : [...list.selected, value],
      );
    return (
      <div className="phone-ent-filters">
        <GroupedList header={list.title}>
          <Cell
            label={list.allLabel}
            current={list.selected.length === 0}
            accessory={
              list.selected.length === 0 ? (
                <Check className="phone-ent-check" aria-hidden />
              ) : undefined
            }
            onClick={() => list.set([])}
          />
          {list.options.map((o) => {
            const on = list.selected.includes(o.value);
            return (
              <Cell
                key={String(o.value)}
                label={o.label}
                aria-pressed={on}
                accessory={on ? <Check className="phone-ent-check" aria-hidden /> : undefined}
                onClick={() => toggle(o.value)}
              />
            );
          })}
        </GroupedList>
      </div>
    );
  }

  const summary = (key: ListKey) => {
    const list = lists[key];
    const picked = list.options.filter((o) => list.selected.includes(o.value));
    if (picked.length === 0) return list.allLabel;
    return picked.length === 1 ? picked[0].label : `${picked[0].label} +${picked.length - 1}`;
  };
  const drill = (key: ListKey) => (
    <Cell
      key={key}
      label={lists[key].title}
      value={summary(key)}
      chevron
      onClick={() => onPage(key)}
    />
  );
  const togglePrazo = (p: (typeof PRAZO_PRESET_ORDER)[number]) =>
    onChange({
      ...filters,
      filterPrazo: filters.filterPrazo.includes(p)
        ? without(filters.filterPrazo, p)
        : [...filters.filterPrazo, p],
    });

  return (
    <div className="phone-ent-filters">
      {!isPosts && (
        <section className="phone-ent-filters__group">
          <h3 className="phone-ent-filters__label">Situação</h3>
          <ChipRow aria-label="Situação" className="phone-ent-filters__chips">
            {STATUS_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={filters.filterStatus.includes(o.value)}
                onClick={() =>
                  onChange({
                    ...filters,
                    filterStatus: filters.filterStatus.includes(o.value)
                      ? without(filters.filterStatus, o.value)
                      : [...filters.filterStatus, o.value],
                  })
                }
              />
            ))}
          </ChipRow>
        </section>
      )}
      <section className="phone-ent-filters__group">
        <h3 className="phone-ent-filters__label">Prazo da etapa</h3>
        <ChipRow aria-label="Prazo da etapa" className="phone-ent-filters__chips">
          {PRAZO_PRESET_ORDER.map((p) => (
            <Chip
              key={p}
              label={PRAZO_PRESET_LABELS[p]}
              selected={filters.filterPrazo.includes(p)}
              onClick={() => togglePrazo(p)}
            />
          ))}
          <Chip
            label="Personalizado"
            selected={customRange}
            onClick={() => {
              if (customRange) onChange({ ...filters, filterPrazoFrom: '', filterPrazoTo: '' });
              setCustomRange(!customRange);
            }}
          />
        </ChipRow>
        {customRange && (
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
        )}
      </section>
      {isPosts && (
        <section className="phone-ent-filters__group">
          <h3 className="phone-ent-filters__label">Tipo</h3>
          <ChipRow aria-label="Tipo" className="phone-ent-filters__chips">
            {TIPO_ORDER.map((t) => (
              <Chip
                key={t}
                label={TIPO_LABELS[t]}
                selected={filters.filterTipos.includes(t)}
                onClick={() =>
                  onChange({
                    ...filters,
                    filterTipos: filters.filterTipos.includes(t)
                      ? without(filters.filterTipos, t)
                      : [...filters.filterTipos, t],
                  })
                }
              />
            ))}
          </ChipRow>
        </section>
      )}
      <GroupedList>
        {(isPosts
          ? (['clientes', 'postStatus', 'membros', 'etapas'] as ListKey[])
          : (['clientes', 'membros', 'postResponsaveis', 'etapas', 'templates'] as ListKey[])
        ).map(drill)}
      </GroupedList>
    </div>
  );
}
