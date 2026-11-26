import { X } from 'lucide-react';
import { channelLabel } from '../../lib/acquisition-channels';
import type { Plan } from '../../lib/api';
import { STATUS_GROUP_LABELS } from '../../lib/subscription';
import { Button } from '../../components/ui/button';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  hasActiveFilters,
  type WorkspacesListParams,
  type WorkspacesParamsPatch,
} from '../workspaces-params';

interface WorkspacesFilterChipsProps {
  params: WorkspacesListParams;
  plans: Plan[];
  total: number | undefined;
  onChange: (patch: WorkspacesParamsPatch) => void;
  onClear: () => void;
}

export interface FilterChip {
  /** Unique per chip: the filter key, plus the value for the multi-select filters. */
  id: string;
  label: string;
  value: string;
  /** Removes just this chip, from the latest params (two quick removals both stick). */
  remove: WorkspacesParamsPatch;
}

/**
 * One chip per active filter value, in the order the toolbar lists them. The multi-select
 * filters get one chip per ticked value, so each can be removed on its own.
 */
export function filterChipsFor(params: WorkspacesListParams, plans: Plan[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (params.q) chips.push({ id: 'q', label: 'Busca', value: params.q, remove: { q: '' } });
  for (const id of params.plano) {
    chips.push({
      id: `plano:${id}`,
      label: 'Plano',
      value: plans.find((p) => p.id === id)?.name ?? id,
      remove: (latest) => ({ plano: latest.plano.filter((v) => v !== id) }),
    });
  }
  for (const g of params.status) {
    chips.push({
      id: `status:${g}`,
      label: 'Status',
      value: STATUS_GROUP_LABELS[g],
      remove: (latest) => ({ status: latest.status.filter((v) => v !== g) }),
    });
  }
  if (params.overrides) {
    chips.push({
      id: 'overrides',
      label: 'Overrides',
      value: OVERRIDES_LABELS[params.overrides],
      remove: { overrides: '' },
    });
  }
  for (const a of params.atividade) {
    chips.push({
      id: `atividade:${a}`,
      label: 'Atividade',
      value: ACTIVITY_LABELS[a],
      remove: (latest) => ({ atividade: latest.atividade.filter((v) => v !== a) }),
    });
  }
  for (const o of params.origem) {
    chips.push({
      id: `origem:${o}`,
      label: 'Origem',
      value: channelLabel(o),
      remove: (latest) => ({ origem: latest.origem.filter((v) => v !== o) }),
    });
  }
  if (params.criado) {
    chips.push({
      id: 'criado',
      label: 'Criado',
      value: CREATED_LABELS[params.criado],
      remove: { criado: '' },
    });
  }
  return chips;
}

export function WorkspacesFilterChips({
  params,
  plans,
  total,
  onChange,
  onClear,
}: WorkspacesFilterChipsProps) {
  if (!hasActiveFilters(params)) return null;
  const chips = filterChipsFor(params, plans);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/15 pl-3 pr-1.5 text-foreground"
        >
          <span className="text-muted-foreground">
            {chip.label}: <span className="font-medium text-foreground">{chip.value}</span>
          </span>
          <button
            type="button"
            aria-label={`Remover filtro ${chip.label}: ${chip.value}`}
            onClick={() => onChange(chip.remove)}
            className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onClear}>
        Limpar filtros
      </Button>
      {total !== undefined ? (
        <span className="ml-auto tabular-nums">
          {total} {total === 1 ? 'resultado' : 'resultados'}
        </span>
      ) : null}
    </div>
  );
}
