import { ChevronUp, ChevronDown } from 'lucide-react';
import type { BoardCard } from '../hooks/useEntregasData';

interface ListViewProps {
  cards: BoardCard[];
  sort: { column: string; direction: 'asc' | 'desc' };
  onSortChange: (sort: { column: string; direction: 'asc' | 'desc' }) => void;
  onCardClick: (card: BoardCard) => void;
}

type Column = { key: string; label: string };
const COLUMNS: Column[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'etapa', label: 'Etapa atual' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'status', label: 'Status' },
];

function getStatusBadge(card: BoardCard) {
  const dl = card.deadline;
  if (dl.estourado) return { label: 'Atrasado', color: '#ef4444' };
  if (dl.urgente) return { label: 'Urgente', color: '#eab308' };
  return { label: 'Em dia', color: '#3ecf8e' };
}

function sortCards(cards: BoardCard[], column: string, direction: 'asc' | 'desc'): BoardCard[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (column) {
      case 'titulo': return dir * a.workflow.titulo.localeCompare(b.workflow.titulo);
      case 'cliente': return dir * ((a.cliente?.nome || '').localeCompare(b.cliente?.nome || ''));
      case 'etapa': return dir * a.etapa.nome.localeCompare(b.etapa.nome);
      case 'responsavel': return dir * ((a.membro?.nome || '').localeCompare(b.membro?.nome || ''));
      case 'prazo': return dir * (a.deadline.diasRestantes - b.deadline.diasRestantes);
      case 'status': {
        const order = (c: BoardCard) => c.deadline.estourado ? 0 : c.deadline.urgente ? 1 : 2;
        return dir * (order(a) - order(b));
      }
      default: return 0;
    }
  });
}

function formatPrazo(card: BoardCard): string {
  const d = card.deadline;
  if (d.estourado) return `${Math.abs(d.diasRestantes)}d atrasado`;
  if (d.diasRestantes === 0) return `${d.horasRestantes}h restantes`;
  return `${d.diasRestantes}d restantes`;
}

export function ListView({ cards, sort, onSortChange, onCardClick }: ListViewProps) {
  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const sorted = sortCards(cards, sort.column, sort.direction);

  const handleSort = (key: string) => {
    if (sort.column === key) {
      onSortChange({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ column: key, direction: 'asc' });
    }
  };

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '0.75rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-color)',
                  color: sort.column === col.key ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  {col.label}
                  {sort.column === col.key
                    ? sort.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    : null
                  }
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(card => {
            const badge = getStatusBadge(card);
            return (
              <tr
                key={card.workflow.id}
                onClick={() => onCardClick(card)}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '0.75rem 1rem' }}>{card.workflow.titulo}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}>
                    {card.cliente?.nome || '—'}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{card.etapa.nome}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{card.membro?.nome || '—'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{formatPrazo(card)}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: 12, background: badge.color + '22', color: badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                    {badge.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
