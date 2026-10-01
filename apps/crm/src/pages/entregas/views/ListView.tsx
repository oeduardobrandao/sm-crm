import { useState } from 'react';
import { ChevronUp, ChevronDown, FileText } from 'lucide-react';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import { DEADLINE_STATUS, classifyDeadline } from '../deadlineStatus';
import { etapaDeadlineDate } from '../etapaPrazo';
import type { ListGroupBy } from '../viewQuery';
import { allGroupsCollapsed, groupListRows, toggleKey } from '../listGrouping';
import { ListGroupHeaderRow } from '../components/ListGroupHeaderRow';
import { ListGroupsToggle } from '../components/ListGroupsToggle';

interface ListViewProps {
  cards: BoardCard[];
  /** Processos individuais (spec §4.4: mesmos tipos e filtro de entidade do Kanban). */
  postEntities?: PostEntity[];
  sort: { column: string; direction: 'asc' | 'desc' };
  onSortChange: (sort: { column: string; direction: 'asc' | 'desc' }) => void;
  onCardClick: (card: BoardCard) => void;
  onPostClick?: (entity: PostEntity) => void;
  /** "Agrupar por" da Lista. 'nenhum' (padrão) = tabela corrida. Sem data de
   *  postagem aqui: um fluxo tem vários posts, e 'postagem' agrupa por prazo. */
  groupBy?: ListGroupBy;
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

/** Projeção comum de fluxo e post para a tabela: etapa, responsável e prazo
 *  resolvidos pela entidade. */
interface ListRow {
  key: string;
  titulo: string;
  clienteId: number | null;
  clienteNome: string;
  clienteCor: string | undefined;
  etapaNome: string;
  responsavelId: number | null;
  responsavelNome: string;
  deadline: BoardCard['deadline'];
  /** Dia do prazo da etapa, ou null sem prazo resolvido (agrupamento por prazo). */
  prazoDate: Date | null;
  /** false quando a entidade não tem prazo efetivo (etapa não ativada ou prazo
   *  limpo). deadline vem com um fallback zerado nesse caso (spec §7) e não
   *  deve ser lido como "vence em 0h" -- ver formatPrazo. */
  hasDeadline: boolean;
  individual: boolean;
  open: () => void;
}

const EMPTY_POST_ENTITIES: PostEntity[] = [];

/** Same three buckets the board, the Visão geral and the filters use. */
function getStatusBadge(row: ListRow) {
  const { label, cssVar } = DEADLINE_STATUS[classifyDeadline(row.deadline)];
  return { label, color: `var(${cssVar})` };
}

function sortRows(rows: ListRow[], column: string, direction: 'asc' | 'desc'): ListRow[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (column) {
      case 'titulo':
        return dir * a.titulo.localeCompare(b.titulo);
      case 'cliente':
        return dir * a.clienteNome.localeCompare(b.clienteNome);
      case 'etapa':
        return dir * a.etapaNome.localeCompare(b.etapaNome);
      case 'responsavel':
        return dir * a.responsavelNome.localeCompare(b.responsavelNome);
      case 'prazo':
        return dir * (a.deadline.diasRestantes - b.deadline.diasRestantes);
      case 'status': {
        const order = (r: ListRow) => (r.deadline.estourado ? 0 : r.deadline.urgente ? 1 : 2);
        return dir * (order(a) - order(b));
      }
      default:
        return 0;
    }
  });
}

function formatPrazo(row: ListRow): string {
  if (!row.hasDeadline) return 'Sem prazo';
  const d = row.deadline;
  if (d.estourado) return `${Math.abs(d.diasRestantes)}d atrasado`;
  if (d.diasRestantes === 0) return `${d.horasRestantes}h restantes`;
  return `${d.diasRestantes}d restantes`;
}

export function ListView({
  cards,
  postEntities = EMPTY_POST_ENTITIES,
  sort,
  onSortChange,
  onCardClick,
  onPostClick,
  groupBy = 'nenhum',
}: ListViewProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  if (cards.length === 0 && postEntities.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const rows: ListRow[] = [
    ...cards.map<ListRow>((card) => ({
      key: `wf-${card.workflow.id}`,
      titulo: card.workflow.titulo,
      clienteId: card.workflow.cliente_id ?? card.cliente?.id ?? null,
      clienteNome: card.cliente?.nome || '',
      clienteCor: card.cliente?.cor,
      etapaNome: card.etapa.nome,
      responsavelId: card.etapa.responsavel_id ?? null,
      responsavelNome: card.membro?.nome || '',
      deadline: card.deadline,
      prazoDate: etapaDeadlineDate(card),
      hasDeadline: true,
      individual: false,
      open: () => onCardClick(card),
    })),
    ...postEntities.map<ListRow>((e) => ({
      key: e.id,
      titulo: e.titulo,
      clienteId: e.process.post.cliente_id ?? null,
      clienteNome: e.cliente?.nome || e.process.post.cliente_nome || '',
      clienteCor: e.cliente?.cor,
      etapaNome: e.etapaNome,
      responsavelId: e.step.responsavel_id ?? null,
      responsavelNome: e.responsavel?.nome || '',
      deadline: e.deadline,
      prazoDate: e.prazoEfetivo,
      hasDeadline: e.prazoEfetivo != null,
      individual: true,
      open: () => onPostClick?.(e),
    })),
  ];
  const sorted = sortRows(rows, sort.column, sort.direction);

  const handleSort = (key: string) => {
    if (sort.column === key) {
      onSortChange({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ column: key, direction: 'asc' });
    }
  };

  const renderRow = (row: ListRow) => {
    const badge = getStatusBadge(row);
    return (
      <tr
        key={row.key}
        onClick={row.open}
        style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <td style={{ padding: '0.75rem 1rem' }}>
          {row.titulo}
          {row.individual && (
            <span
              className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
              style={{ marginLeft: '0.5rem' }}
            >
              <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
              Individual
            </span>
          )}
        </td>
        <td style={{ padding: '0.75rem 1rem' }}>
          <span
            style={{
              borderLeft: `3px solid ${row.clienteCor || '#888'}`,
              paddingLeft: '0.5rem',
            }}
          >
            {row.clienteNome || '—'}
          </span>
        </td>
        <td style={{ padding: '0.75rem 1rem' }}>{row.etapaNome}</td>
        <td style={{ padding: '0.75rem 1rem' }}>{row.responsavelNome || '—'}</td>
        <td style={{ padding: '0.75rem 1rem' }}>{formatPrazo(row)}</td>
        <td style={{ padding: '0.75rem 1rem' }}>
          <span
            style={{
              padding: '0.2rem 0.6rem',
              borderRadius: 12,
              background: `color-mix(in srgb, ${badge.color} 13%, transparent)`,
              color: badge.color,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {badge.label}
          </span>
        </td>
      </tr>
    );
  };

  const groups =
    groupBy === 'nenhum'
      ? null
      : groupListRows(
          sorted,
          groupBy,
          {
            prazo: (r) => ({ date: r.prazoDate, deadline: r.deadline }),
            cliente: (r) => ({ id: r.clienteId, nome: r.clienteNome }),
            responsavel: (r) => ({ id: r.responsavelId, nome: r.responsavelNome }),
            etapa: (r) => r.etapaNome,
          },
          new Date(),
        );
  const groupKeys = groups?.map((g) => g.key) ?? [];
  const allCollapsed = allGroupsCollapsed(groupKeys, collapsed);

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
      {groups && groups.length > 1 && (
        <ListGroupsToggle
          allCollapsed={allCollapsed}
          onToggle={() => setCollapsed(allCollapsed ? new Set() : new Set(groupKeys))}
        />
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
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
                  {sort.column === col.key ? (
                    sort.direction === 'asc' ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <tbody key={g.key}>
                <ListGroupHeaderRow
                  label={g.label}
                  sub={g.sub}
                  count={g.rows.length}
                  danger={g.danger}
                  colSpan={COLUMNS.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((prev) => toggleKey(prev, g.key))}
                />
                {!isCollapsed && g.rows.map(renderRow)}
              </tbody>
            );
          })
        ) : (
          <tbody>{sorted.map(renderRow)}</tbody>
        )}
      </table>
    </div>
  );
}
