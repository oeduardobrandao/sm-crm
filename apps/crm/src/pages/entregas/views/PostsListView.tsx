import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Plus } from 'lucide-react';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../hooks/useEntregasData';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { formatPostDate } from '@/utils/postDate';
import { etapaDeadlineDate, formatEtapaDeadlineDay, formatEtapaPrazo } from '../etapaPrazo';
import { POST_STATUS_ORDER, TIPO_LABELS } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { PostStatusChip } from '../components/PostStatusChip';

interface PostsListViewProps {
  posts: ActivePost[];
  isLoading: boolean;
  openableWorkflowIds: Set<number>;
  onPostClick: (post: ActivePost) => void;
  /** Fluxo tag click — opens the whole workflow card (not a single post). */
  onFluxoClick: (workflowId: number) => void;
  /** Unfiltered board cards keyed by workflow id — source of the workflow's
   *  cliente (avatar/cor), current etapa, its responsible and its deadline. */
  cardsByWorkflowId: Map<number, BoardCard>;
  /** True while any Publicações filter (busca, cliente, etc.) narrows `posts` --
   *  the empty state only offers "Criar post avulso" once it's genuinely empty. */
  filtersActive: boolean;
  /** Opens NewAvulsoDialog from the unfiltered empty state's CTA. */
  onCreateAvulso: () => void;
}

type Column = { key: string; label: string };
const COLUMNS: Column[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'fluxo', label: 'Fluxo' },
  { key: 'etapa', label: 'Etapa atual' },
  { key: 'tipo', label: 'Tipo' },
  { key: 'status', label: 'Status' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'prazo_etapa', label: 'Prazo da etapa' },
  { key: 'agendado', label: 'Agendado para' },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const oneLineCell: React.CSSProperties = {
  padding: '0.6rem 1rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 220,
};

/** Read-only sortable table of every post across active workflows. Clicking a row
 *  opens the post in its workflow drawer. */
export function PostsListView({
  posts,
  isLoading,
  openableWorkflowIds,
  onPostClick,
  onFluxoClick,
  cardsByWorkflowId,
  filtersActive,
  onCreateAvulso,
}: PostsListViewProps) {
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'agendado',
    direction: 'asc',
  });
  const statusRegistry = useStatusRegistry();

  // A post avulso has no workflow_id to look up -- undefined here means the same
  // "no card" state every caller below already treats as "no etapa/prazo/fluxo".
  const cardOf = (p: ActivePost) =>
    p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined;
  const membroNome = (p: ActivePost) => cardOf(p)?.membro?.nome || '';

  const sorted = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const column = sort.column;
    // A post avulso has no workflow_id to look up -- undefined here sinks it to
    // the end of the etapa/prazo sorts and empties its responsável, same as any
    // other workflow with no matching card.
    const cardForSort = (p: ActivePost) =>
      p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined;
    const nome = (p: ActivePost) => cardForSort(p)?.membro?.nome || '';
    const etapaNome = (p: ActivePost) => cardForSort(p)?.etapa.nome || '';
    // Sort key for the etapa deadline: overdue first, then soonest; posts whose
    // workflow has no card/deadline sink to the end in BOTH directions.
    const prazoDias = (p: ActivePost) => cardForSort(p)?.deadline.diasRestantes;
    return [...posts].sort((a, b) => {
      switch (column) {
        case 'titulo':
          return dir * a.titulo.localeCompare(b.titulo);
        case 'cliente':
          return dir * a.cliente_nome.localeCompare(b.cliente_nome);
        case 'fluxo':
          return dir * (a.workflow_titulo ?? '').localeCompare(b.workflow_titulo ?? '');
        case 'tipo':
          return dir * TIPO_LABELS[a.tipo].localeCompare(TIPO_LABELS[b.tipo]);
        case 'status':
          return dir * (POST_STATUS_ORDER.indexOf(a.status) - POST_STATUS_ORDER.indexOf(b.status));
        case 'etapa':
          return dir * etapaNome(a).localeCompare(etapaNome(b));
        case 'responsavel':
          return dir * nome(a).localeCompare(nome(b));
        case 'prazo_etapa': {
          const da = prazoDias(a);
          const db = prazoDias(b);
          if (da == null && db == null) return 0;
          if (da == null) return 1;
          if (db == null) return -1;
          return dir * (da - db);
        }
        case 'agendado': {
          // Unscheduled posts sink to the bottom in BOTH directions.
          if (a.scheduled_at == null && b.scheduled_at == null) return 0;
          if (a.scheduled_at == null) return 1;
          if (b.scheduled_at == null) return -1;
          return dir * a.scheduled_at.localeCompare(b.scheduled_at);
        }
        default:
          return 0;
      }
    });
  }, [posts, sort, cardsByWorkflowId]);

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        {filtersActive ? (
          <p>Nenhum post encontrado. Ajuste os filtros.</p>
        ) : (
          <>
            <p>Nenhum post por aqui ainda.</p>
            <Button type="button" onClick={onCreateAvulso} style={{ marginTop: '1rem' }}>
              <Plus className="h-4 w-4" />
              Criar post avulso
            </Button>
          </>
        )}
      </div>
    );
  }

  const handleSort = (key: string) => {
    if (sort.column === key) {
      setSort({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      setSort({ column: key, direction: 'asc' });
    }
  };

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
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
        <tbody>
          {sorted.map((p) => {
            const workflowId = p.workflow_id;
            // A post avulso (no workflow) is always openable -- only a wired post
            // depends on its workflow still being an active, loaded card.
            const openable = workflowId == null || openableWorkflowIds.has(workflowId);
            const card = cardOf(p);
            const prazo = card ? formatEtapaPrazo(card.deadline) : null;
            const prazoDate = card ? etapaDeadlineDate(card) : null;
            return (
              <tr
                key={p.id}
                onClick={openable ? () => onPostClick(p) : undefined}
                style={{
                  cursor: openable ? 'pointer' : 'default',
                  borderBottom: '1px solid var(--border-color)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={oneLineCell}>{p.titulo || 'Post sem título'}</td>
                <td style={{ padding: '0.6rem 1rem' }}>
                  {p.cliente_id != null ? (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {card?.clienteAvatarUrl ? (
                            <img
                              src={card.clienteAvatarUrl}
                              alt={p.cliente_nome}
                              loading="lazy"
                              decoding="async"
                              className="board-post-cliente-avatar"
                              style={{ display: 'block' }}
                            />
                          ) : (
                            <span
                              className="board-post-cliente-avatar board-post-cliente-avatar--initials"
                              style={{ background: card?.cliente?.cor || 'var(--surface-hover)' }}
                            >
                              {getInitials(p.cliente_nome || '?')}
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipContent>{p.cliente_nome || '—'}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ ...oneLineCell, overflow: 'visible' }}>
                  {workflowId == null ? (
                    <span className="post-fluxo-tag post-fluxo-tag--avulso">Avulso</span>
                  ) : card ? (
                    <button
                      type="button"
                      className="post-fluxo-tag"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFluxoClick(workflowId);
                      }}
                      title={`Abrir fluxo: ${p.workflow_titulo}`}
                    >
                      {p.workflow_titulo}
                    </button>
                  ) : (
                    <span className="post-fluxo-tag post-fluxo-tag--static">
                      {p.workflow_titulo}
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
                  {card?.etapa.nome || '—'}
                </td>
                <td style={{ padding: '0.6rem 1rem' }}>
                  <span className="post-tipo-badge">{TIPO_LABELS[p.tipo]}</span>
                </td>
                <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
                  <PostStatusChip post={p} registry={statusRegistry} />
                </td>
                <td
                  style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}
                  title={card ? `Etapa: ${card.etapa.nome}` : undefined}
                >
                  {membroNome(p) || '—'}
                </td>
                <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
                  {prazo ? (
                    <>
                      <span style={{ color: prazo.color, fontWeight: 600 }}>{prazo.label}</span>
                      {prazoDate && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}
                          · {formatEtapaDeadlineDay(prazoDate)}
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
                  {p.scheduled_at ? formatPostDate(p.scheduled_at) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
