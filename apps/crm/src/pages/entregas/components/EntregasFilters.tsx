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

const STATUS_OPTIONS: { id: FilterState['filterStatus']; label: string; color?: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'atrasado', label: 'Atrasados', color: '#ef4444' },
  { id: 'urgente', label: 'Urgentes', color: '#ea580c' },
  { id: 'em_dia', label: 'Em dia', color: '#3ecf8e' },
];

export function EntregasFilters({ filters, onChange, clientes, membros }: EntregasFiltersProps) {
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  return (
    <div
      className="leads-toolbar animate-up"
      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 0 }}
    >
      {/* Status pill group */}
      <div
        style={{
          display: 'flex',
          gap: '0.15rem',
          background: 'var(--surface-2)',
          padding: '0.2rem',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
        }}
      >
        {STATUS_OPTIONS.map(({ id, label, color }) => {
          const active = filters.filterStatus === id;
          return (
            <button
              key={id}
              onClick={() => onChange({ ...filters, filterStatus: id })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '7px',
                border: 'none',
                background: active ? 'var(--card-bg)' : 'transparent',
                color: active ? 'var(--text-main)' : 'var(--text-muted)',
                fontSize: '0.75rem',
                fontWeight: active ? 700 : 500,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.15s',
                boxShadow: active
                  ? '0 1px 2px rgba(15, 23, 42, 0.06), 0 0 0 1px var(--border-color)'
                  : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {color && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    opacity: active ? 1 : 0.5,
                    boxShadow: active ? `0 0 0 2px ${color}33` : 'none',
                  }}
                />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div
        style={{
          width: '1px',
          height: '24px',
          background: 'var(--border-color)',
          flexShrink: 0,
        }}
      />

      {/* Client + member selects */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap' }}>
        <Select
          value={filters.filterCliente ? String(filters.filterCliente) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterCliente: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger style={{ minWidth: 180 }}>
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
          <SelectTrigger style={{ minWidth: 180 }}>
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
