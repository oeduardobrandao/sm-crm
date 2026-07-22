import { useState } from 'react';
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';

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
}

export const EMPTY_FILTERS: FilterState = {
  filterClientes: [],
  filterMembros: [],
  filterPostResponsaveis: [],
  filterStatus: [],
  filterSearch: '',
  filterEtapas: [],
  filterTemplates: [],
};

interface EntregasFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  etapaNames: string[];
}

const STATUS_OPTIONS: { value: StatusFilter; label: string; color: string }[] = [
  { value: 'atrasado', label: 'Atrasados', color: '#ef4444' },
  { value: 'urgente', label: 'Urgentes', color: '#ea580c' },
  { value: 'em_dia', label: 'Em dia', color: '#3ecf8e' },
];

function countActiveFilters(filters: FilterState): number {
  return [
    filters.filterClientes,
    filters.filterMembros,
    filters.filterPostResponsaveis,
    filters.filterStatus,
    filters.filterEtapas,
    filters.filterTemplates,
  ].filter((v) => v.length > 0).length;
}

interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
  color?: string;
}

/**
 * Pill dropdown holding any number of selected values.
 * Trigger reads "<first label> +N" once more than one option is picked.
 */
function MultiSelectFilter<T extends string | number>({
  placeholder,
  options,
  selected,
  onSelectedChange,
  isStacked,
}: {
  placeholder: string;
  options: MultiSelectOption<T>[];
  selected: T[];
  onSelectedChange: (next: T[]) => void;
  isStacked: boolean;
}) {
  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const first = selectedOptions[0];
  const label = !first
    ? placeholder
    : selectedOptions.length === 1
      ? first.label
      : `${first.label} +${selectedOptions.length - 1}`;

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
          className={`h-9 px-4 text-xs gap-1.5 font-normal shadow-sm mb-0 justify-between ${
            isStacked ? 'w-full rounded-lg' : 'rounded-full w-auto min-w-[160px]'
          } ${selected.length > 0 ? 'border-[var(--primary-color)]' : ''}`}
        >
          <span className="flex items-center gap-1.5 truncate">
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

function FilterControls({
  filters,
  onChange,
  layout,
  activeClientes,
  sortedMembros,
  sortedTemplates,
  sortedEtapaNames,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  layout: 'inline' | 'stacked';
  activeClientes: Cliente[];
  sortedMembros: { id?: number; nome: string }[];
  sortedTemplates: WorkflowTemplate[];
  sortedEtapaNames: string[];
}) {
  const isStacked = layout === 'stacked';
  const membroOptions = sortedMembros
    .filter((m) => m.id != null)
    .map((m) => ({ value: m.id!, label: m.nome }));

  return (
    <div className={isStacked ? 'flex flex-col gap-4' : 'flex flex-wrap items-center gap-3'}>
      <MultiSelectFilter
        placeholder="Status"
        options={STATUS_OPTIONS}
        selected={filters.filterStatus}
        onSelectedChange={(filterStatus) => onChange({ ...filters, filterStatus })}
        isStacked={isStacked}
      />

      <div className={isStacked ? 'flex flex-col gap-3' : 'flex gap-2 flex-nowrap'}>
        <MultiSelectFilter
          placeholder="Todos os clientes"
          options={activeClientes
            .filter((c) => c.id != null)
            .map((c) => ({ value: c.id!, label: c.nome }))}
          selected={filters.filterClientes}
          onSelectedChange={(filterClientes) => onChange({ ...filters, filterClientes })}
          isStacked={isStacked}
        />
        <MultiSelectFilter
          placeholder="Todos os membros"
          options={membroOptions}
          selected={filters.filterMembros}
          onSelectedChange={(filterMembros) => onChange({ ...filters, filterMembros })}
          isStacked={isStacked}
        />
        <MultiSelectFilter
          placeholder="Responsável do post"
          options={membroOptions}
          selected={filters.filterPostResponsaveis}
          onSelectedChange={(filterPostResponsaveis) =>
            onChange({ ...filters, filterPostResponsaveis })
          }
          isStacked={isStacked}
        />
        <MultiSelectFilter
          placeholder="Todas as etapas"
          options={sortedEtapaNames.map((name) => ({ value: name, label: name }))}
          selected={filters.filterEtapas}
          onSelectedChange={(filterEtapas) => onChange({ ...filters, filterEtapas })}
          isStacked={isStacked}
        />
        <MultiSelectFilter
          placeholder="Todos os templates"
          options={sortedTemplates
            .filter((t) => t.id != null)
            .map((t) => ({ value: t.id!, label: t.nome }))}
          selected={filters.filterTemplates}
          onSelectedChange={(filterTemplates) => onChange({ ...filters, filterTemplates })}
          isStacked={isStacked}
        />
      </div>
    </div>
  );
}

export function EntregasFilters({
  filters,
  onChange,
  clientes,
  membros,
  templates,
  etapaNames,
}: EntregasFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeClientes = clientes
    .filter((c) => c.status === 'ativo')
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedTemplates = [...templates].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedEtapaNames = [...etapaNames].sort((a, b) => a.localeCompare(b));
  const activeCount = countActiveFilters(filters);

  const sharedProps = {
    filters,
    onChange,
    activeClientes,
    sortedMembros,
    sortedTemplates,
    sortedEtapaNames,
  };

  return (
    <>
      {/* Desktop: inline filters */}
      <div className="hidden min-[901px]:flex flex-wrap items-center gap-3 mb-0 animate-up">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
          <Input
            placeholder="Buscar fluxo..."
            value={filters.filterSearch}
            onChange={(e) => onChange({ ...filters, filterSearch: e.target.value })}
            className="!rounded-full !text-xs h-9 pl-8 pr-4 mb-0 w-[180px]"
          />
        </div>
        <div className="w-px h-6 bg-border shrink-0" />
        <FilterControls layout="inline" {...sharedProps} />
        {activeCount > 0 && (
          <Button
            variant="ghost"
            className="h-9 px-3 text-xs font-normal mb-0"
            onClick={() => onChange({ ...EMPTY_FILTERS, filterSearch: filters.filterSearch })}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Mobile: search + filter button that opens sheet */}
      <div className="flex min-[901px]:hidden items-center gap-2 mb-0 animate-up">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
          <Input
            placeholder="Buscar fluxo..."
            value={filters.filterSearch}
            onChange={(e) => onChange({ ...filters, filterSearch: e.target.value })}
            className="!rounded-full !text-xs h-9 pl-8 pr-4 mb-0 w-full"
          />
        </div>
        <Button
          variant="outline"
          className="h-9 rounded-full px-3 text-xs gap-1.5 font-normal shadow-sm shrink-0"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          {activeCount > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none"
              style={{
                background: 'var(--primary-color)',
                color: '#000',
                width: '1.1rem',
                height: '1.1rem',
              }}
            >
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] max-h-[85vh] overflow-y-auto pb-24">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">Filtros</SheetTitle>
            <SheetDescription className="sr-only">Filtre as entregas</SheetDescription>
          </SheetHeader>
          <FilterControls layout="stacked" {...sharedProps} />
          {activeCount > 0 && (
            <Button
              variant="ghost"
              className="w-full mt-4 text-xs"
              onClick={() => onChange({ ...EMPTY_FILTERS, filterSearch: filters.filterSearch })}
            >
              Limpar filtros
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
