import type { KeyboardEvent } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { parseISO, format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GripVertical, Lock } from 'lucide-react';
import { MonthGrid } from '@/components/ui/month-grid';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ClientePost } from '@/store/posts';
import { TIPO_LABELS } from '../postLabels';

export const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);
export const LOCKED_TOOLTIPS: Record<string, string> = {
  agendado: 'Post já agendado no Instagram — cancele o agendamento para mover',
  postado: 'Post já publicado',
  falha_publicacao: 'Post com falha de publicação — resolva o erro antes de reagendar',
};

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
  // remains the keyboard-drag activator.
  const { listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (isDragging) wasDraggingRef.current = true;
  }, [isDragging]);

  const handleClick = () => {
    // A finished drag emits a trailing click on the origin element; ignore exactly one.
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    onSelect(post);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(post);
    }
  };

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const color = isCurrentWorkflow ? '#eab308' : '#3ecf8e';
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${TIPO_LABELS[post.tipo]} — ${post.titulo || 'Post sem título'}${time ? ` — ${time}` : ''}`}
      className={`calendar-post-pill${isSelected ? ' selected' : ''}`}
      style={{
        background: color,
        opacity: isDragging ? 0.4 : isLocked ? 0.6 : isCurrentWorkflow ? 1 : 0.8,
        cursor: canDrag ? 'grab' : 'pointer',
      }}
      title={tooltip}
      {...(canDrag ? listeners : {})}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {isLocked && <Lock className="h-2.5 w-2.5" style={{ flexShrink: 0 }} />}
      {canDrag && (
        <span
          ref={setActivatorNodeRef}
          className="calendar-pill-handle"
          tabIndex={0}
          aria-label="Mover post (arraste, ou foque e use as setas)"
          style={{ display: 'inline-flex', cursor: 'grab' }}
          onKeyDown={(e) => {
            // Let dnd-kit's keyboard sensor activate a drag from the handle, then stop the
            // event so it doesn't bubble to the pill's select handler.
            (listeners as Record<string, ((ev: KeyboardEvent) => void) | undefined>)?.onKeyDown?.(
              e,
            );
            e.stopPropagation();
          }}
        >
          <GripVertical className="h-2.5 w-2.5" style={{ flexShrink: 0, opacity: 0.7 }} />
        </span>
      )}
      <span className="pill-text">
        {TIPO_LABELS[post.tipo]} · {time}
      </span>
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
            const dot = post.workflow_id === currentWorkflowId ? '#eab308' : '#3ecf8e';
            return (
              <button
                key={post.id}
                type="button"
                className="calendar-day-popover-row"
                onClick={() => {
                  onSelectPost(post);
                  setOpen(false);
                }}
              >
                <span className="calendar-day-popover-dot" style={{ background: dot }} />
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
