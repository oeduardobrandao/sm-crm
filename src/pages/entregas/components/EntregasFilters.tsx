import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function EntregasFilters({ filters, onChange, clientes, membros }: EntregasFiltersProps) {
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  return (
    <div className="leads-toolbar animate-up">
      <div className="filter-bar" style={{ margin: 0 }}>
        {(['todos', 'atrasado', 'urgente', 'em_dia'] as const).map(s => (
          <button
            key={s}
            className={`filter-btn${filters.filterStatus === s ? ' active' : ''}`}
            onClick={() => onChange({ ...filters, filterStatus: s })}
          >
            {s === 'todos' ? 'Todos' : s === 'atrasado' ? '🔴 Atrasados' : s === 'urgente' ? '🟡 Urgentes' : '🟢 Em dia'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Select
          value={filters.filterCliente ? String(filters.filterCliente) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterCliente: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os clientes</SelectItem>
            {activeClientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterMembro ? String(filters.filterMembro) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterMembro: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os membros" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os membros</SelectItem>
            {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
