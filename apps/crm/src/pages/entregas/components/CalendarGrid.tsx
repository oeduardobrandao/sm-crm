import { useDroppable, useDraggable } from '@dnd-kit/core';
import { parseISO, format, isSameDay } from 'date-fns';
import { GripVertical, Lock } from 'lucide-react';
import { MonthGrid } from '@/components/ui/month-grid';
import type { ClientePost } from '@/store/posts';

const TIPO_COLORS: Record<string, string> = {
  feed: '#eab308',
  reels: '#E1306C',
  stories: '#42c8f5',
  carrossel: '#3ecf8e',
};
const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};
const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);
const LOCKED_TOOLTIPS: Record<string, string> = {
  agendado: 'Post já agendado no Instagram — cancele o agendamento para mover',
  postado: 'Post já publicado',
  falha_publicacao: 'Post com falha de publicação — resolva o erro antes de reagendar',
};

interface CalendarGridProps {
  currentMonth: Date;
  scheduledPosts: ClientePost[];
  currentWorkflowId: number;
  onMonthChange: (date: Date) => void;
}

function PostPill({ post, currentWorkflowId }: { post: ClientePost; currentWorkflowId: number }) {
  const isCurrentWorkflow = post.workflow_id === currentWorkflowId;
  const isLocked = LOCKED_STATUSES.has(post.status);
  const canDrag = isCurrentWorkflow && !isLocked;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const color = isCurrentWorkflow ? '#eab308' : '#3ecf8e';
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  return (
    <div
      ref={setNodeRef}
      className="calendar-post-pill"
      style={{
        background: color,
        opacity: isDragging ? 0.4 : isLocked ? 0.6 : isCurrentWorkflow ? 1 : 0.8,
        cursor: canDrag ? 'grab' : 'default',
      }}
      title={tooltip}
      {...(canDrag ? { ...attributes, ...listeners } : {})}
    >
      {isLocked && <Lock className="h-2.5 w-2.5" style={{ flexShrink: 0 }} />}
      {canDrag && <GripVertical className="h-2.5 w-2.5" style={{ flexShrink: 0, opacity: 0.7 }} />}
      <span className="pill-text">
        {TIPO_LABELS[post.tipo]} · {time}
      </span>
    </div>
  );
}

function DroppableCell({
  date,
  isCurrentMonth,
  posts,
  currentWorkflowId,
}: {
  date: Date;
  isCurrentMonth: boolean;
  posts: ClientePost[];
  currentWorkflowId: number;
}) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` });

  const today = new Date();
  const isToday = isSameDay(date, today);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const maxVisible = 2;
  const visiblePosts = posts.slice(0, maxVisible);
  const overflow = posts.length - maxVisible;

  return (
    <div
      ref={setNodeRef}
      className={`calendar-cell ${!isCurrentMonth ? 'out-of-month' : ''} ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}
      style={{
        border: isOver ? '2px dashed rgba(234, 179, 8, 0.4)' : undefined,
        boxShadow: isOver ? '0 0 12px rgba(234, 179, 8, 0.12)' : undefined,
      }}
    >
      <div
        className="cell-day-number"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}
      >
        {date.getDate()}
      </div>
      <div className="cell-posts">
        {visiblePosts.map((post) => (
          <PostPill key={post.id} post={post} currentWorkflowId={currentWorkflowId} />
        ))}
        {overflow > 0 && (
          <div
            className="cell-overflow"
            title={posts
              .slice(maxVisible)
              .map((p) => `${TIPO_LABELS[p.tipo]} · ${p.titulo}`)
              .join('\n')}
          >
            +{overflow} mais
          </div>
        )}
      </div>
      {isOver && <div className="cell-drop-hint">Soltar aqui</div>}
    </div>
  );
}

export function CalendarGrid({
  currentMonth,
  scheduledPosts,
  currentWorkflowId,
  onMonthChange,
}: CalendarGridProps) {
  return (
    <MonthGrid
      currentMonth={currentMonth}
      onMonthChange={onMonthChange}
      renderCell={(date, isCurrentMonth) => {
        const dayPosts = scheduledPosts.filter((p) => {
          if (!p.scheduled_at) return false;
          const postDate = parseISO(p.scheduled_at);
          return isSameDay(postDate, date);
        });
        return (
          <DroppableCell
            date={date}
            isCurrentMonth={isCurrentMonth}
            posts={dayPosts}
            currentWorkflowId={currentWorkflowId}
          />
        );
      }}
    />
  );
}
