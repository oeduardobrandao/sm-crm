import { useMemo } from 'react';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../hooks/useEntregasData';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { formatPostDate } from '@/utils/postDate';
import { avatarColorClass } from '@/lib/avatarColor';
import { formatEtapaPrazo } from '../etapaPrazo';
import { TIPO_LABELS } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { StatusKey } from '../statusRegistry';
import { PostStatusChip } from '../components/PostStatusChip';

interface PostsKanbanViewProps {
  posts: ActivePost[];
  isLoading: boolean;
  openableWorkflowIds: Set<number>;
  onPostClick: (workflowId: number, postId: number) => void;
  /** Unfiltered board cards keyed by workflow id — source of the workflow's
   *  cliente (avatar/cor), current etapa, its responsible and its deadline. */
  cardsByWorkflowId: Map<number, BoardCard>;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Read-only kanban of every post across active workflows, one column per post
 * status in pipeline order. Clicking a post opens its workflow drawer focused on
 * it — status changes happen there, not by dragging (agendado/postado/falha are
 * system-driven).
 */
export function PostsKanbanView({
  posts,
  isLoading,
  openableWorkflowIds,
  onPostClick,
  cardsByWorkflowId,
}: PostsKanbanViewProps) {
  const registry = useStatusRegistry();
  const byStatus = useMemo(() => {
    const map = new Map<StatusKey, ActivePost[]>(registry.options.map((o) => [o.key, []]));
    // Input arrives ordered scheduled_at asc nulls-last from the query.
    // resolve() falls back to the canonical column while defs load, so posts
    // never vanish from the board.
    for (const p of posts) map.get(registry.resolve(p).key)?.push(p);
    return map;
  }, [posts, registry]);

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
        <p>Nenhum post encontrado. Ajuste os filtros.</p>
      </div>
    );
  }

  return (
    <div className="board-rows-wrapper animate-up">
      <div className="board-container">
        {registry.options.map((option) => {
          const columnPosts = byStatus.get(option.key) ?? [];
          return (
            <div key={option.key} className="board-column">
              <div className="board-column-header">
                <span className="board-column-title">
                  {option.kind === 'custom' && (
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: option.color,
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                  )}
                  {option.label}
                </span>
                <span className="board-column-count">{columnPosts.length}</span>
              </div>
              <div className="board-column-body">
                {columnPosts.length === 0 ? (
                  <div className="board-empty">Nenhum post</div>
                ) : (
                  columnPosts.map((p) => {
                    const openable = openableWorkflowIds.has(p.workflow_id);
                    const card = cardsByWorkflowId.get(p.workflow_id);
                    const membro = card?.membro;
                    const prazo = card ? formatEtapaPrazo(card.deadline) : null;
                    return (
                      <div
                        key={p.id}
                        className="scheduled-item board-post-card"
                        style={{ cursor: openable ? 'pointer' : 'default' }}
                        onClick={openable ? () => onPostClick(p.workflow_id, p.id) : undefined}
                      >
                        <div className="item-top">
                          <span className="post-tipo-badge">{TIPO_LABELS[p.tipo]}</span>
                          <PostStatusChip post={p} registry={registry} />
                        </div>
                        <div className="item-title">{p.titulo || 'Post sem título'}</div>
                        {card && <div className="board-post-etapa">{card.etapa.nome}</div>}
                        <div className="item-meta board-post-footer">
                          <span className="board-post-footer-left">
                            {p.cliente_id != null && (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    {card?.clienteAvatarUrl ? (
                                      <img
                                        src={card.clienteAvatarUrl}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="board-post-cliente-avatar"
                                      />
                                    ) : (
                                      <span
                                        className="board-post-cliente-avatar board-post-cliente-avatar--initials"
                                        style={{
                                          background: card?.cliente?.cor || 'var(--surface-hover)',
                                        }}
                                      >
                                        {getInitials(p.cliente_nome || '?')}
                                      </span>
                                    )}
                                  </TooltipTrigger>
                                  <TooltipContent>{p.cliente_nome || '—'}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            <span>
                              {p.scheduled_at ? formatPostDate(p.scheduled_at) : 'Sem data'}
                            </span>
                          </span>
                          {card && (membro || prazo) && (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="board-post-assignee">
                                    {membro && (
                                      <>
                                        <span
                                          className={`avatar board-post-assignee-avatar ${avatarColorClass(membro.id ?? membro.nome)}`}
                                        >
                                          {getInitials(membro.nome)}
                                        </span>
                                        {membro.nome.split(' ')[0]}
                                      </>
                                    )}
                                    {prazo && (
                                      <span
                                        className="board-post-prazo"
                                        style={{ color: prazo.color }}
                                      >
                                        {prazo.shortLabel}
                                      </span>
                                    )}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {`${card.etapa.nome}${membro ? `: ${membro.nome}` : ''}${prazo ? ` · ${prazo.label}` : ''}`}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
