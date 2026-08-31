import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleDot,
  Gauge,
  LayoutTemplate,
  Milestone,
  Shapes,
  SlidersHorizontal,
  UserCheck,
  UserPen,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Cliente, Membro, WorkflowPost, WorkflowTemplate } from '../../../store';
import { TIPO_ORDER, TIPO_LABELS, TIPO_COLORS } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { StatusKey } from '../statusRegistry';
import { PRAZO_PRESET_LABELS, PRAZO_PRESET_ORDER, type PrazoPreset } from '../etapaPrazo';

export type StatusFilter = 'atrasado' | 'urgente' | 'em_dia';

/** Every dropdown is multi-select: an empty array means "no filter" (show all). */
export interface FilterState {
  filterClientes: number[];
  filterMembros: number[];
  filterPostResponsaveis: number[];
  filterStatus: StatusFilter[];
  filterSearch: string;
  filterEtapas: string[];
  filterTemplates: number[];
  filterTipos: WorkflowPost['tipo'][];
  filterPostStatus: StatusKey[];
  filterPrazo: PrazoPreset[];
  /** Custom etapa-deadline range, 'YYYY-MM-DD' or '' for an open end. */
  filterPrazoFrom: string;
  filterPrazoTo: string;
}

export const EMPTY_FILTERS: FilterState = {
  filterClientes: [],
  filterMembros: [],
  filterPostResponsaveis: [],
  filterStatus: [],
  filterSearch: '',
  filterEtapas: [],
  filterTemplates: [],
  filterTipos: [],
  filterPostStatus: [],
  filterPrazo: [],
  filterPrazoFrom: '',
  filterPrazoTo: '',
};

/** 'posts': the Publicações modes — only busca, cliente and responsável do post
 *  apply to posts; the workflow-shaped dropdowns (status, membros, etapas,
 *  templates) are hidden and their state is simply not read. */
export type FiltersMode = 'entregas' | 'posts';

interface EntregasFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  etapaNames: string[];
  mode?: FiltersMode;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string; color: string }[] = [
  { value: 'atrasado', label: 'Atrasados', color: '#ef4444' },
  { value: 'urgente', label: 'Urgentes', color: '#ea580c' },
  { value: 'em_dia', label: 'Em dia', color: '#3ecf8e' },
];

function countActiveFilters(filters: FilterState, mode: FiltersMode): number {
  const counted =
    mode === 'posts'
      ? [
          filters.filterClientes,
          filters.filterMembros,
          filters.filterEtapas,
          filters.filterTipos,
          filters.filterPostStatus,
        ]
      : [
          filters.filterClientes,
          filters.filterMembros,
          filters.filterPostResponsaveis,
          filters.filterStatus,
          filters.filterEtapas,
          filters.filterTemplates,
        ];
  const prazoActive =
    mode === 'posts' &&
    (filters.filterPrazo.length > 0 || !!filters.filterPrazoFrom || !!filters.filterPrazoTo);
  return counted.filter((v) => v.length > 0).length + (prazoActive ? 1 : 0);
}

interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
  color?: string;
}

/** "<first label> +N" summary once more than one option is picked. */
function summarizeSelection<T extends string | number>(
  options: MultiSelectOption<T>[],
  selected: T[],
): string | null {
  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const first = selectedOptions[0];
  if (!first) return null;
  return selectedOptions.length === 1
    ? first.label
    : `${first.label} +${selectedOptions.length - 1}`;
}

/**
 * Pill dropdown holding any number of selected values.
 * Trigger reads "<first label> +N" once more than one option is picked.
 */
function MultiSelectFilter<T extends string | number>({
  placeholder,
  icon: Icon,
  options,
  selected,
  onSelectedChange,
  isStacked,
}: {
  placeholder: string;
  icon?: LucideIcon;
  options: MultiSelectOption<T>[];
  selected: T[];
  onSelectedChange: (next: T[]) => void;
  isStacked: boolean;
}) {
  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const first = selectedOptions[0];
  const label = summarizeSelection(options, selected) ?? placeholder;

  const toggle = (value: T) => {
    onSelectedChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`h-9 px-3 text-xs gap-1.5 font-normal shadow-sm mb-0 justify-between ${
            isStacked ? 'w-full rounded-lg' : 'rounded-full w-auto'
          } ${selected.length > 0 ? 'border-[var(--primary-color)]' : ''}`}
        >
          <span className="flex items-center gap-1.5 truncate">
            {Icon && <Icon className="h-3.5 w-3.5 opacity-60 shrink-0" />}
            {first?.color && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: first.color }}
              />
            )}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] overflow-y-auto min-w-[200px]">
        {options.length === 0 && (
          <DropdownMenuItem disabled className="text-xs">
            Nenhuma opção
          </DropdownMenuItem>
        )}
        {options.map((o) => {
          const isChecked = selected.includes(o.value);
          return (
            // A plain item with an always-visible box: the shared CheckboxItem only
            // renders a tick once checked, which hides that these are multi-select.
            <DropdownMenuItem
              key={String(o.value)}
              role="menuitemcheckbox"
              aria-checked={isChecked}
              className="gap-2 text-xs"
              // Keep the menu open so several values can be picked in one go
              onSelect={(e) => {
                e.preventDefault();
                toggle(o.value);
              }}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                  isChecked
                    ? 'border-[var(--primary-color)] bg-[var(--primary-color)]'
                    : 'border-input'
                }`}
              >
                {isChecked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
              </span>
              <span className="flex items-center gap-1.5">
                {o.color && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: o.color }}
                  />
                )}
                {o.label}
              </span>
            </DropdownMenuItem>
          );
        })}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSelectedChange([])} className="text-xs">
              Limpar seleção
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Summary the prazo trigger and its chip share: "Hoje +1" | "Personalizado". */
function prazoSummary(filters: FilterState): string | null {
  const rangeActive = !!filters.filterPrazoFrom || !!filters.filterPrazoTo;
  const activeCount = filters.filterPrazo.length + (rangeActive ? 1 : 0);
  if (activeCount === 0) return null;
  return filters.filterPrazo.length > 0
    ? `${PRAZO_PRESET_LABELS[filters.filterPrazo[0]]}${activeCount > 1 ? ` +${activeCount - 1}` : ''}`
    : 'Personalizado';
}

/**
 * "Prazo da etapa" filter: preset buckets (Atrasado/Hoje/Amanhã/Próximos 7 dias)
 * plus a custom date range for fine-tuning. A Popover instead of a DropdownMenu
 * because it embeds date inputs — menu keyboard/typeahead would fight them.
 */
function PrazoEtapaFilter({
  filters,
  onChange,
  isStacked,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  isStacked: boolean;
}) {
  const { filterPrazo, filterPrazoFrom, filterPrazoTo } = filters;
  const summary = prazoSummary(filters);
  const label = summary ?? 'Prazo da etapa';

  const togglePreset = (preset: PrazoPreset) => {
    onChange({
      ...filters,
      filterPrazo: filterPrazo.includes(preset)
        ? filterPrazo.filter((p) => p !== preset)
        : [...filterPrazo, preset],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`h-9 px-3 text-xs gap-1.5 font-normal shadow-sm mb-0 justify-between ${
            isStacked ? 'w-full rounded-lg' : 'rounded-full w-auto'
          } ${summary ? 'border-[var(--primary-color)]' : ''}`}
        >
          <span className="flex items-center gap-1.5 truncate">
            <CalendarClock className="h-3.5 w-3.5 opacity-60 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <div className="flex flex-col">
          {PRAZO_PRESET_ORDER.map((preset) => {
            const isChecked = filterPrazo.includes(preset);
            return (
              <button
                key={preset}
                type="button"
                role="menuitemcheckbox"
                aria-checked={isChecked}
                onClick={() => togglePreset(preset)}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent text-left"
              >
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                    isChecked
                      ? 'border-[var(--primary-color)] bg-[var(--primary-color)]'
                      : 'border-input'
                  }`}
                >
                  {isChecked && <Check className="h-3 w-3 text-black" strokeWidth={3} />}
                </span>
                {PRAZO_PRESET_LABELS[preset]}
              </button>
            );
          })}
        </div>
        <div className="mt-2 border-t pt-2">
          <p className="px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Personalizado
          </p>
          <div className="flex items-center gap-2 px-2">
            <label className="flex flex-1 min-w-0 flex-col gap-1 text-[0.65rem] text-muted-foreground">
              De
              <Input
                type="date"
                value={filterPrazoFrom}
                onChange={(e) => onChange({ ...filters, filterPrazoFrom: e.target.value })}
                className="h-8 w-full min-w-0 !text-xs mb-0 px-2"
              />
            </label>
            <label className="flex flex-1 min-w-0 flex-col gap-1 text-[0.65rem] text-muted-foreground">
              Até
              <Input
                type="date"
                value={filterPrazoTo}
                onChange={(e) => onChange({ ...filters, filterPrazoTo: e.target.value })}
                className="h-8 w-full min-w-0 !text-xs mb-0 px-2"
              />
            </label>
          </div>
        </div>
        {summary && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, filterPrazo: [], filterPrazoFrom: '', filterPrazoTo: '' })
            }
            className="mt-2 w-full rounded-sm px-2 py-1.5 text-xs hover:bg-accent text-left"
          >
            Limpar seleção
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Removable summary of a filter that lives inside "Mais filtros": it keeps an
 * active hidden filter visible on the toolbar, so nothing filters the board
 * invisibly. Editing still happens in the popover; the X clears the dimension.
 */
function ActiveFilterChip({
  icon: Icon,
  dimension,
  summary,
  onClear,
}: {
  icon: LucideIcon;
  dimension: string;
  summary: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--primary-color)] bg-transparent px-3 text-xs shadow-sm">
      <Icon className="h-3.5 w-3.5 opacity-60 shrink-0" />
      <span className="truncate max-w-[160px]">
        {dimension} · {summary}
      </span>
      <button
        type="button"
        aria-label={`Remover filtro de ${dimension}`}
        onClick={onClear}
        className="ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export function EntregasFilters({
  filters,
  onChange,
  clientes,
  membros,
  templates,
  etapaNames,
  mode = 'entregas',
}: EntregasFiltersProps) {
  const isPosts = mode === 'posts';
  const statusRegistry = useStatusRegistry();
  const activeClientes = clientes
    .filter((c) => c.status === 'ativo')
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedTemplates = [...templates].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedEtapaNames = [...etapaNames].sort((a, b) => a.localeCompare(b));
  const activeCount = countActiveFilters(filters, mode);

  const clienteOptions = activeClientes
    .filter((c) => c.id != null)
    .map((c) => ({ value: c.id!, label: c.nome }));
  const membroOptions = sortedMembros
    .filter((m) => m.id != null)
    .map((m) => ({ value: m.id!, label: m.nome }));
  const etapaOptions = sortedEtapaNames.map((name) => ({ value: name, label: name }));
  const templateOptions = sortedTemplates
    .filter((t) => t.id != null)
    .map((t) => ({ value: t.id!, label: t.nome }));
  const tipoOptions = TIPO_ORDER.map((tipo) => ({
    value: tipo,
    label: TIPO_LABELS[tipo],
    color: TIPO_COLORS[tipo],
  }));
  const postStatusOptions = statusRegistry.options.map((o) => ({
    value: o.key,
    label: o.kind === 'custom' ? `· ${o.label}` : o.label,
    color: o.color,
  }));

  // Anything not on the toolbar lives in "Mais filtros"; when active it also
  // surfaces as a removable chip so the applied filter stays visible.
  const secondaryChips = (
    isPosts
      ? [
          {
            key: 'etapas',
            icon: Milestone,
            dimension: 'Etapa',
            summary: summarizeSelection(etapaOptions, filters.filterEtapas),
            clear: () => onChange({ ...filters, filterEtapas: [] }),
          },
          {
            key: 'tipos',
            icon: Shapes,
            dimension: 'Tipo',
            summary: summarizeSelection(tipoOptions, filters.filterTipos),
            clear: () => onChange({ ...filters, filterTipos: [] }),
          },
          {
            key: 'prazo',
            icon: CalendarClock,
            dimension: 'Prazo',
            summary: prazoSummary(filters),
            clear: () =>
              onChange({ ...filters, filterPrazo: [], filterPrazoFrom: '', filterPrazoTo: '' }),
          },
        ]
      : [
          {
            key: 'postResponsaveis',
            icon: UserPen,
            dimension: 'Resp. do post',
            summary: summarizeSelection(membroOptions, filters.filterPostResponsaveis),
            clear: () => onChange({ ...filters, filterPostResponsaveis: [] }),
          },
          {
            key: 'etapas',
            icon: Milestone,
            dimension: 'Etapa',
            summary: summarizeSelection(etapaOptions, filters.filterEtapas),
            clear: () => onChange({ ...filters, filterEtapas: [] }),
          },
          {
            key: 'templates',
            icon: LayoutTemplate,
            dimension: 'Template',
            summary: summarizeSelection(templateOptions, filters.filterTemplates),
            clear: () => onChange({ ...filters, filterTemplates: [] }),
          },
        ]
  ).filter((chip): chip is typeof chip & { summary: string } => chip.summary != null);

  return (
    <div className="flex flex-wrap items-center gap-2 mb-0 animate-up flex-1 min-w-[240px] min-[901px]:justify-end">
      {/* Primary filters, always on the toolbar. The busca input lives on the
          VistasTabs row above (EntregasPage renders it), not here. */}
      {isPosts ? (
        <>
          <MultiSelectFilter
            placeholder="Cliente"
            icon={Users}
            options={clienteOptions}
            selected={filters.filterClientes}
            onSelectedChange={(filterClientes) => onChange({ ...filters, filterClientes })}
            isStacked={false}
          />
          <MultiSelectFilter
            placeholder="Status do post"
            icon={CircleDot}
            options={postStatusOptions}
            selected={filters.filterPostStatus}
            onSelectedChange={(filterPostStatus) => onChange({ ...filters, filterPostStatus })}
            isStacked={false}
          />
          <MultiSelectFilter
            placeholder="Responsável"
            icon={UserCheck}
            options={membroOptions}
            selected={filters.filterMembros}
            onSelectedChange={(filterMembros) => onChange({ ...filters, filterMembros })}
            isStacked={false}
          />
        </>
      ) : (
        <>
          <MultiSelectFilter
            placeholder="Status"
            icon={Gauge}
            options={STATUS_OPTIONS}
            selected={filters.filterStatus}
            onSelectedChange={(filterStatus) => onChange({ ...filters, filterStatus })}
            isStacked={false}
          />
          <MultiSelectFilter
            placeholder="Cliente"
            icon={Users}
            options={clienteOptions}
            selected={filters.filterClientes}
            onSelectedChange={(filterClientes) => onChange({ ...filters, filterClientes })}
            isStacked={false}
          />
          <MultiSelectFilter
            placeholder="Responsável"
            icon={UserCheck}
            options={membroOptions}
            selected={filters.filterMembros}
            onSelectedChange={(filterMembros) => onChange({ ...filters, filterMembros })}
            isStacked={false}
          />
        </>
      )}

      {secondaryChips.map((chip) => (
        <ActiveFilterChip
          key={chip.key}
          icon={chip.icon}
          dimension={chip.dimension}
          summary={chip.summary}
          onClear={chip.clear}
        />
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 rounded-full px-3 text-xs gap-1.5 font-normal shadow-sm mb-0 shrink-0"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Mais filtros
            {secondaryChips.length > 0 && (
              <span
                className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none"
                style={{
                  background: 'var(--primary-color)',
                  color: '#000',
                  width: '1.1rem',
                  height: '1.1rem',
                }}
              >
                {secondaryChips.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[300px] p-4">
          <div className="flex flex-col gap-3">
            {isPosts ? (
              <>
                <MultiSelectFilter
                  placeholder="Todas as etapas"
                  icon={Milestone}
                  options={etapaOptions}
                  selected={filters.filterEtapas}
                  onSelectedChange={(filterEtapas) => onChange({ ...filters, filterEtapas })}
                  isStacked
                />
                <MultiSelectFilter
                  placeholder="Todos os tipos"
                  icon={Shapes}
                  options={tipoOptions}
                  selected={filters.filterTipos}
                  onSelectedChange={(filterTipos) => onChange({ ...filters, filterTipos })}
                  isStacked
                />
                <PrazoEtapaFilter filters={filters} onChange={onChange} isStacked />
              </>
            ) : (
              <>
                <MultiSelectFilter
                  placeholder="Responsável do post"
                  icon={UserPen}
                  options={membroOptions}
                  selected={filters.filterPostResponsaveis}
                  onSelectedChange={(filterPostResponsaveis) =>
                    onChange({ ...filters, filterPostResponsaveis })
                  }
                  isStacked
                />
                <MultiSelectFilter
                  placeholder="Todas as etapas"
                  icon={Milestone}
                  options={etapaOptions}
                  selected={filters.filterEtapas}
                  onSelectedChange={(filterEtapas) => onChange({ ...filters, filterEtapas })}
                  isStacked
                />
                <MultiSelectFilter
                  placeholder="Todos os templates"
                  icon={LayoutTemplate}
                  options={templateOptions}
                  selected={filters.filterTemplates}
                  onSelectedChange={(filterTemplates) => onChange({ ...filters, filterTemplates })}
                  isStacked
                />
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {activeCount > 0 && (
        <Button
          variant="ghost"
          className="h-9 px-3 text-xs font-normal mb-0 shrink-0"
          onClick={() => onChange({ ...EMPTY_FILTERS, filterSearch: filters.filterSearch })}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
