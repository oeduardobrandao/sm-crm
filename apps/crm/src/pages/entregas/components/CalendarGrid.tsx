import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { parseISO, format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GripVertical, Lock, Folder } from 'lucide-react';
import { MonthGrid } from '@/components/ui/month-grid';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ClientePost } from '@/store/posts';
import { TIPO_LABELS, TIPO_COLORS, LOCKED_STATUSES, LOCKED_TOOLTIPS } from '../postLabels';

// Re-exported for existing consumers (UnscheduledPostsSidebar, WorkflowCalendarView) —
// postLabels.ts is the single source now, shared with the Publicações kanban's drag guard.
export { LOCKED_STATUSES, LOCKED_TOOLTIPS };

interface CalendarGridProps {
  currentMonth: Date;
  scheduledPosts: ClientePost[];
  currentWorkflowId: number;
  selectedPostId: number | null;
  onSelectPost: (post: ClientePost) => void;
  onMonthChange: (date: Date) => void;
}

function PostPill({
  post,
  currentWorkflowId,
  isSelected,
  onSelect,
}: {
  post: ClientePost;
  currentWorkflowId: number;
  isSelected: boolean;
  onSelect: (post: ClientePost) => void;
}) {
  const isCurrentWorkflow = post.workflow_id === currentWorkflowId;
  const isLocked = LOCKED_STATUSES.has(post.status);
  // Ownership is shown (green pill + workflow name in the detail panel) but is no longer
  // a permission boundary for dates — only lock status is. Unscheduling stays own-workflow
  // only, enforced in resolveCalendarDrop.
  const canDrag = !isLocked;

  // The whole pill is the drag surface. We still omit dnd's `attributes` (role/aria/tabIndex)
  // because the pill owns its own button semantics, and we re-declare `onKeyDown` after the
  // listener spread so Enter/Space selects instead of starting a keyboard drag. The grip
  // remains the keyboard-drag activator. We don't need to swallow the trailing click a
  // finished drag emits on the origin element — dnd-kit's own AbstractPointerSensor already
  // stops it: when the activation constraints are met it registers a `click` listener on
  // `document` with `{ capture: true }` that calls `stopPropagation`, so the click never
  // reaches this element's `onClick` at all.
  const { listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(post);
    }
  };

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const titulo = post.titulo || 'Post sem título';
  // The dash carries tipo; the written tipo label sits right beside it, so colour is never
  // the only channel (feed/carrossel sit on the red/green axis). Ownership moved to the card
  // surface + the workflow name, which says *whose* it is instead of merely "not yours".
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${TIPO_LABELS[post.tipo]} — ${titulo}${time ? ` — ${time}` : ''}${
        !isCurrentWorkflow ? ` — workflow ${post.workflow_titulo}` : ''
      }`}
      className={`calendar-post-card${isSelected ? ' selected' : ''}${
        isCurrentWorkflow ? '' : ' foreign'
      }${isLocked ? ' locked' : ''}`}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: canDrag ? 'grab' : 'pointer' }}
      title={tooltip}
      {...(canDrag ? listeners : {})}
      onClick={() => onSelect(post)}
      onKeyDown={handleKeyDown}
    >
      <div className="post-card-meta">
        <span
          className="post-card-dash"
          style={{ background: TIPO_COLORS[post.tipo] }}
          aria-hidden="true"
        />
        <span className="post-card-tipo">{TIPO_LABELS[post.tipo]}</span>
        {time && <span className="post-card-time">{time}</span>}
        {isLocked && <Lock className="post-card-lock h-2.5 w-2.5" aria-hidden="true" />}
        {canDrag && (
          <span
            ref={setActivatorNodeRef}
            className="calendar-pill-handle"
            tabIndex={0}
            aria-label="Mover post (arraste, ou foque e use as setas)"
            onKeyDown={(e) => {
              // Let dnd-kit's keyboard sensor activate a drag from the handle, then stop the
              // event so it doesn't bubble to the card's select handler.
              (listeners as Record<string, ((ev: KeyboardEvent) => void) | undefined>)?.onKeyDown?.(
                e,
              );
              e.stopPropagation();
            }}
          >
            <GripVertical className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <div className="post-card-title">{titulo}</div>
      {!isCurrentWorkflow && (
        <div className="post-card-workflow">
          <Folder className="h-2.5 w-2.5" aria-hidden="true" />
          <span className="post-card-workflow-name">{post.workflow_titulo}</span>
        </div>
      )}
    </div>
  );
}

function DayPostsPopover({
  date,
  posts,
  overflow,
  currentWorkflowId,
  onSelectPost,
}: {
  date: Date;
  posts: ClientePost[];
  overflow: number;
  currentWorkflowId: number;
  onSelectPost: (post: ClientePost) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="cell-overflow" onClick={(e) => e.stopPropagation()}>
          +{overflow} mais
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="calendar-day-popover">
        <div className="calendar-day-popover-title">
          {format(date, "dd 'de' MMMM", { locale: ptBR })}
        </div>
        <div className="calendar-day-popover-list">
          {posts.map((post) => {
            const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
            const isForeign = post.workflow_id !== currentWorkflowId;
            return (
              <button
                key={post.id}
                type="button"
                className={`calendar-day-popover-row${isForeign ? ' foreign' : ''}`}
                onClick={() => {
                  onSelectPost(post);
                  setOpen(false);
                }}
                title={isForeign ? `Workflow: ${post.workflow_titulo}` : undefined}
              >
                <span
                  className="calendar-day-popover-dot"
                  style={{ background: TIPO_COLORS[post.tipo] }}
                  aria-hidden="true"
                />
                <span className="calendar-day-popover-tipo">{TIPO_LABELS[post.tipo]}</span>
                <span className="calendar-day-popover-row-title">
                  {post.titulo || 'Post sem título'}
                </span>
                <span className="calendar-day-popover-time">{time}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DroppableCell({
  date,
  isCurrentMonth,
  posts,
  currentWorkflowId,
  selectedPostId,
  onSelectPost,
}: {
  date: Date;
  isCurrentMonth: boolean;
  posts: ClientePost[];
  currentWorkflowId: number;
  selectedPostId: number | null;
  onSelectPost: (post: ClientePost) => void;
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
          <PostPill
            key={post.id}
            post={post}
            currentWorkflowId={currentWorkflowId}
            isSelected={selectedPostId === post.id}
            onSelect={onSelectPost}
          />
        ))}
        {overflow > 0 && (
          <DayPostsPopover
            date={date}
            posts={posts}
            overflow={overflow}
            currentWorkflowId={currentWorkflowId}
            onSelectPost={onSelectPost}
          />
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
  selectedPostId,
  onSelectPost,
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
            selectedPostId={selectedPostId}
            onSelectPost={onSelectPost}
          />
        );
      }}
    />
  );
}
