import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { Cliente, Membro } from '../../../store';

export interface FilterState {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

interface EntregasFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
}

const STATUS_OPTIONS: { id: FilterState['filterStatus']; label: string; color?: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'atrasado', label: 'Atrasados', color: '#ef4444' },
  { id: 'urgente', label: 'Urgentes', color: '#ea580c' },
  { id: 'em_dia', label: 'Em dia', color: '#3ecf8e' },
];

export function EntregasFilters({ filters, onChange, clientes, membros }: EntregasFiltersProps) {
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  return (
    <div className="flex flex-wrap items-center gap-3 mb-0 animate-up">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 rounded-full px-4 text-xs gap-1.5 font-normal shadow-sm mb-0">
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

      <div className="w-px h-6 bg-border shrink-0" />

      {/* Client + member selects */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap' }}>
        <Select
          value={filters.filterCliente ? String(filters.filterCliente) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterCliente: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[160px]">
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
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[160px]">
            <SelectValue placeholder="Todos os membros" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os membros</SelectItem>
            {membros.map(m => (
              <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
