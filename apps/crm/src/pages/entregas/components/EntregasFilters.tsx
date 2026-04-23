import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';

export interface FilterState {
  filterCliente: number | null;
  filterMembro: number | null;
  filterPostResponsavel: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
  filterSearch: string;
  filterEtapa: string | null;
  filterTemplate: number | null;
}

interface EntregasFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  etapaNames: string[];
}

const STATUS_OPTIONS: { id: FilterState['filterStatus']; label: string; color?: string }[] = [
  { id: 'todos', label: 'Status' },
  { id: 'atrasado', label: 'Atrasados', color: '#ef4444' },
  { id: 'urgente', label: 'Urgentes', color: '#ea580c' },
  { id: 'em_dia', label: 'Em dia', color: '#3ecf8e' },
];

function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.filterCliente) count++;
  if (filters.filterMembro) count++;
  if (filters.filterPostResponsavel) count++;
  if (filters.filterStatus !== 'todos') count++;
  if (filters.filterEtapa) count++;
  if (filters.filterTemplate) count++;
  return count;
}

function FilterControls({ filters, onChange, layout, activeClientes, sortedMembros, sortedTemplates, sortedEtapaNames }: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  layout: 'inline' | 'stacked';
  activeClientes: Cliente[];
  sortedMembros: { id?: number; nome: string }[];
  sortedTemplates: WorkflowTemplate[];
  sortedEtapaNames: string[];
}) {
  const isStacked = layout === 'stacked';

  return (
    <div className={isStacked ? 'flex flex-col gap-4' : 'flex flex-wrap items-center gap-3'}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className={`h-9 ${isStacked ? 'w-full justify-between rounded-lg' : 'rounded-full'} px-4 text-xs gap-1.5 font-normal shadow-sm mb-0`}>
            {(() => {
              const opt = STATUS_OPTIONS.find(o => o.id === filters.filterStatus);
              return (
                <>
                  {opt?.color && <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: opt.color }} />}
                  {opt?.label ?? 'Status'}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </>
              );
            })()}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup
            value={filters.filterStatus}
            onValueChange={(v) => onChange({ ...filters, filterStatus: v as FilterState['filterStatus'] })}
          >
            {STATUS_OPTIONS.map(({ id, label, color }) => (
              <DropdownMenuRadioItem key={id} value={id}>
                <span className="flex items-center gap-1.5">
                  {color && <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />}
                  {label}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className={isStacked ? 'flex flex-col gap-3' : 'flex gap-2 flex-nowrap'}>
        <Select
          value={filters.filterCliente ? String(filters.filterCliente) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterCliente: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger className={`!text-xs h-9 px-4 mb-0 ${isStacked ? '!rounded-lg w-full' : '!rounded-full w-auto min-w-[160px]'}`}>
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os clientes</SelectItem>
            {activeClientes.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterMembro ? String(filters.filterMembro) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterMembro: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger className={`!text-xs h-9 px-4 mb-0 ${isStacked ? '!rounded-lg w-full' : '!rounded-full w-auto min-w-[160px]'}`}>
            <SelectValue placeholder="Todos os membros" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os membros</SelectItem>
            {sortedMembros.map(m => (
              <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterPostResponsavel ? String(filters.filterPostResponsavel) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterPostResponsavel: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger className={`!text-xs h-9 px-4 mb-0 ${isStacked ? '!rounded-lg w-full' : '!rounded-full w-auto min-w-[160px]'}`}>
            <SelectValue placeholder="Responsável do post" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Responsável do post</SelectItem>
            {sortedMembros.map(m => (
              <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterEtapa ?? '__none__'}
          onValueChange={val => onChange({ ...filters, filterEtapa: val === '__none__' ? null : val })}
        >
          <SelectTrigger className={`!text-xs h-9 px-4 mb-0 ${isStacked ? '!rounded-lg w-full' : '!rounded-full w-auto min-w-[160px]'}`}>
            <SelectValue placeholder="Todas as etapas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todas as etapas</SelectItem>
            {sortedEtapaNames.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterTemplate ? String(filters.filterTemplate) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterTemplate: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger className={`!text-xs h-9 px-4 mb-0 ${isStacked ? '!rounded-lg w-full' : '!rounded-full w-auto min-w-[160px]'}`}>
            <SelectValue placeholder="Todos os templates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os templates</SelectItem>
            {sortedTemplates.map(t => (
              <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function EntregasFilters({ filters, onChange, clientes, membros, templates, etapaNames }: EntregasFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeClientes = clientes.filter(c => c.status === 'ativo').sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedMembros = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedTemplates = [...templates].sort((a, b) => a.nome.localeCompare(b.nome));
  const sortedEtapaNames = [...etapaNames].sort((a, b) => a.localeCompare(b));
  const activeCount = countActiveFilters(filters);

  const sharedProps = { filters, onChange, activeClientes, sortedMembros, sortedTemplates, sortedEtapaNames };

  return (
    <>
      {/* Desktop: inline filters */}
      <div className="hidden min-[901px]:flex flex-wrap items-center gap-3 mb-0 animate-up">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
          <Input
            placeholder="Buscar fluxo..."
            value={filters.filterSearch}
            onChange={e => onChange({ ...filters, filterSearch: e.target.value })}
            className="!rounded-full !text-xs h-9 pl-8 pr-4 mb-0 w-[180px]"
          />
        </div>
        <div className="w-px h-6 bg-border shrink-0" />
        <FilterControls layout="inline" {...sharedProps} />
      </div>

      {/* Mobile: search + filter button that opens sheet */}
      <div className="flex min-[901px]:hidden items-center gap-2 mb-0 animate-up">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
          <Input
            placeholder="Buscar fluxo..."
            value={filters.filterSearch}
            onChange={e => onChange({ ...filters, filterSearch: e.target.value })}
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
              style={{ background: 'var(--primary-color)', color: '#000', width: '1.1rem', height: '1.1rem' }}
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
              onClick={() => {
                onChange({ ...filters, filterCliente: null, filterMembro: null, filterPostResponsavel: null, filterStatus: 'todos', filterEtapa: null, filterTemplate: null });
              }}
            >
              Limpar filtros
            </Button>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
