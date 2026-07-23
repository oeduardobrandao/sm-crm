import { useDroppable, useDraggable, useDndContext } from '@dnd-kit/core';
import type { ClientePost } from '@/store/posts';
import { TIPO_LABELS, TIPO_BADGE_COLORS, TIPO_COLORS, TIPO_ORDER } from '../postLabels';
import { LOCKED_STATUSES } from './CalendarGrid';

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
  const { active } = useDndContext();
  const draggingPost = active?.data.current?.post as ClientePost | undefined;
  // Don't invite a drop we're going to reject.
  const willAccept = !draggingPost || draggingPost.workflow_id === currentWorkflowId;
  const highlight = isOver && willAccept;

  const currentWorkflowPosts = posts.filter((p) => p.workflow_id === currentWorkflowId);

  return (
    <div
      ref={setNodeRef}
      className="calendar-sidebar"
      style={{
        borderColor: highlight ? 'var(--primary-color)' : undefined,
        boxShadow: highlight ? '0 0 12px rgba(234, 179, 8, 0.2)' : undefined,
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
        <div className="sidebar-legend-tipos">
          {TIPO_ORDER.map((tipo) => (
            <span key={tipo} className="sidebar-legend-item">
              <span className="sidebar-legend-dash" style={{ background: TIPO_COLORS[tipo] }} />
              {TIPO_LABELS[tipo]}
            </span>
          ))}
        </div>
        <div className="sidebar-legend-item sidebar-legend-item--ownership">
          <span className="sidebar-legend-swatch" />
          De outro workflow
        </div>
      </div>
    </div>
  );
}
