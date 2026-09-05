import { X } from 'lucide-react';
import type { Plan } from '../../lib/api';
import { STATUS_GROUP_LABELS } from '../../lib/subscription';
import { Button } from '../../components/ui/button';
import {
  ACTIVITY_LABELS,
  CREATED_LABELS,
  OVERRIDES_LABELS,
  hasActiveFilters,
  type WorkspacesListParams,
} from '../workspaces-params';

interface WorkspacesFilterChipsProps {
  params: WorkspacesListParams;
  plans: Plan[];
  total: number | undefined;
  onChange: (patch: Partial<WorkspacesListParams>) => void;
  onClear: () => void;
}

interface Chip {
  key: keyof WorkspacesListParams;
  label: string;
  value: string;
}

function chipsFor(params: WorkspacesListParams, plans: Plan[]): Chip[] {
  const chips: Chip[] = [];
  if (params.q) chips.push({ key: 'q', label: 'Busca', value: params.q });
  if (params.plano) {
    chips.push({
      key: 'plano',
      label: 'Plano',
      value: plans.find((p) => p.id === params.plano)?.name ?? params.plano,
    });
  }
  if (params.status)
    chips.push({ key: 'status', label: 'Status', value: STATUS_GROUP_LABELS[params.status] });
  if (params.overrides)
    chips.push({ key: 'overrides', label: 'Overrides', value: OVERRIDES_LABELS[params.overrides] });
  if (params.atividade)
    chips.push({ key: 'atividade', label: 'Atividade', value: ACTIVITY_LABELS[params.atividade] });
  if (params.criado)
    chips.push({ key: 'criado', label: 'Criado', value: CREATED_LABELS[params.criado] });
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
  const chips = chipsFor(params, plans);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-6 items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 text-foreground"
        >
          <span className="text-muted-foreground">
            {chip.label}: <span className="font-medium text-foreground">{chip.value}</span>
          </span>
          <button
            type="button"
            aria-label={`Remover filtro ${chip.label}`}
            onClick={() => onChange({ [chip.key]: '' } as Partial<WorkspacesListParams>)}
            className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
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
