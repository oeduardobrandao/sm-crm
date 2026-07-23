import { useDroppable, useDraggable } from '@dnd-kit/core';
import type { ClientePost } from '@/store/posts';
import { TIPO_LABELS, TIPO_BADGE_COLORS } from '../postLabels';

const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);

interface UnscheduledPostsSidebarProps {
  posts: ClientePost[];
  currentWorkflowId: number;
}

function DraggablePostCard({ post }: { post: ClientePost }) {
  const isLocked = LOCKED_STATUSES.has(post.status);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unscheduled-${post.id}`,
    data: { post },
    disabled: isLocked,
  });
  const colors = TIPO_BADGE_COLORS[post.tipo];

  return (
    <div
      ref={setNodeRef}
      className="sidebar-post-card"
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: '#eab308',
        cursor: isLocked ? 'not-allowed' : 'grab',
      }}
      {...(isLocked ? {} : { ...attributes, ...listeners })}
      title={isLocked ? 'Post com status bloqueado' : `Arraste para agendar: ${post.titulo}`}
    >
      <div className="sidebar-post-title">{post.titulo || 'Post sem título'}</div>
      <div className="sidebar-post-meta">
        <span className="sidebar-tipo-badge" style={{ background: colors.bg, color: colors.text }}>
          {TIPO_LABELS[post.tipo]}
        </span>
        <span className="sidebar-workflow-label">{post.workflow_titulo}</span>
      </div>
    </div>
  );
}

export function UnscheduledPostsSidebar({
  posts,
  currentWorkflowId,
}: UnscheduledPostsSidebarProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled-zone' });

  const currentWorkflowPosts = posts.filter((p) => p.workflow_id === currentWorkflowId);

  return (
    <div
      ref={setNodeRef}
      className="calendar-sidebar"
      style={{
        borderColor: isOver ? 'var(--primary-color)' : undefined,
        boxShadow: isOver ? '0 0 12px rgba(234, 179, 8, 0.2)' : undefined,
      }}
    >
      <div className="sidebar-header">
        <div className="sidebar-title">Sem data</div>
        <div className="sidebar-subtitle">Arraste para o calendário</div>
      </div>

      <div className="sidebar-posts-list">
        {currentWorkflowPosts.length === 0 ? (
          <div className="sidebar-empty">Todos os posts estão agendados ✓</div>
        ) : (
          currentWorkflowPosts.map((post) => <DraggablePostCard key={post.id} post={post} />)
        )}
      </div>

      <div className="sidebar-legend">
        <div className="sidebar-legend-title">Legenda</div>
        <div className="sidebar-legend-item">
          <div className="sidebar-legend-dot" style={{ background: '#eab308' }} />
          <span>Este workflow</span>
        </div>
        <div className="sidebar-legend-item">
          <div className="sidebar-legend-dot" style={{ background: '#3ecf8e' }} />
          <span>Outros workflows</span>
        </div>
      </div>
    </div>
  );
}
