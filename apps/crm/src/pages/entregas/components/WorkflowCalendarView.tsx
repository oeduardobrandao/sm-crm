import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { X } from 'lucide-react';
import { getClientePosts, updateWorkflowPost, type ClientePost, type Membro } from '@/store';
import { CalendarGrid, LOCKED_STATUSES, LOCKED_TOOLTIPS } from './CalendarGrid';
import { CalendarPostDetailPanel } from './CalendarPostDetailPanel';
import { UnscheduledPostsSidebar } from './UnscheduledPostsSidebar';
import { TimePickerPopover } from './TimePickerPopover';
import { TIPO_LABELS, buildTipoDayMarkers } from '../postLabels';
import { resolveCalendarDrop, formatRescheduleToast } from '../calendarDrop';

interface WorkflowCalendarViewProps {
  clienteId: number;
  clienteNome: string;
  currentWorkflowId: number;
  currentWorkflowTitulo: string;
  onBack: () => void;
  membros?: Membro[];
  onOpenPost?: (postId: number) => void;
  hubUrl?: string;
}

interface PendingDrop {
  postId: number;
  date: Date;
  previousTime?: { hour: number; minute: number };
}

export function WorkflowCalendarView({
  clienteId,
  clienteNome,
  currentWorkflowId,
  currentWorkflowTitulo,
  onBack,
  membros = [],
  onOpenPost,
  hubUrl,
}: WorkflowCalendarViewProps) {
  const qc = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [activePost, setActivePost] = useState<ClientePost | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem('calendarHintDismissed.v2') === 'true',
  );

  // On touch devices a pointer-distance constraint loses to the browser's own scroll
  // gesture, so cards were effectively undraggable on phones. TouchSensor arms on a
  // long press instead: a plain swipe still scrolls the rail and the grid.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const { data: allPosts = [], isLoading } = useQuery({
    queryKey: ['clientePosts', clienteId],
    queryFn: () => getClientePosts(clienteId),
  });

  const scheduledPosts = allPosts.filter((p) => p.scheduled_at != null);
  const unscheduledPosts = allPosts.filter((p) => p.scheduled_at == null);

  const selectedPost = scheduledPosts.find((p) => p.id === selectedPostId) ?? null;
  const selectedIsCurrentWorkflow = selectedPost?.workflow_id === currentWorkflowId;
  const selectedIsLocked = selectedPost ? LOCKED_STATUSES.has(selectedPost.status) : false;

  const detailDayMarkers = useMemo(
    () => buildTipoDayMarkers(allPosts, { excludePostId: selectedPostId ?? undefined }),
    [allPosts, selectedPostId],
  );

  const invalidateQueries = useCallback(
    (workflowId?: number | null) => {
      qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', currentWorkflowId] });
      if (workflowId != null && workflowId !== currentWorkflowId) {
        qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
      }
      qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    },
    [qc, clienteId, currentWorkflowId],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const post = event.active.data.current?.post as ClientePost | undefined;
    setActivePost(post ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActivePost(null);
      const post = event.active.data.current?.post as ClientePost | undefined;
      const result = resolveCalendarDrop({
        post,
        overId: event.over ? String(event.over.id) : undefined,
        currentWorkflowId,
      });

      switch (result.kind) {
        case 'noop':
          return;

        case 'reject-foreign-unschedule':
          toast.info('Só é possível remover a data de posts deste workflow.');
          return;

        case 'unschedule':
          try {
            await updateWorkflowPost(post!.id, { scheduled_at: null });
            invalidateQueries(post!.workflow_id);
            toast.success('Data removida do post');
          } catch {
            toast.error('Erro ao remover data do post');
          }
          return;

        case 'schedule':
          setPendingDrop({
            postId: post!.id,
            date: result.date,
            previousTime: result.previousTime,
          });
          return;
      }
    },
    [invalidateQueries, currentWorkflowId],
  );

  const handleTimeConfirm = useCallback(
    async (datetime: Date) => {
      if (!pendingDrop) return;
      const moved = allPosts.find((p) => p.id === pendingDrop.postId);
      try {
        await updateWorkflowPost(pendingDrop.postId, { scheduled_at: datetime.toISOString() });
        invalidateQueries(moved?.workflow_id);
        toast.success(
          formatRescheduleToast({
            post: moved,
            datetime,
            verb: pendingDrop.previousTime != null ? 'reagendado' : 'agendado',
            currentWorkflowId,
          }),
        );
      } catch {
        toast.error('Erro ao agendar post');
      } finally {
        setPendingDrop(null);
      }
    },
    [pendingDrop, invalidateQueries, allPosts, currentWorkflowId],
  );

  const handleTimeCancel = useCallback(() => {
    setPendingDrop(null);
  }, []);

  const handlePanelReschedule = useCallback(
    async (datetime: Date) => {
      if (!selectedPost) return;
      try {
        await updateWorkflowPost(selectedPost.id, { scheduled_at: datetime.toISOString() });
        invalidateQueries(selectedPost.workflow_id);
        toast.success(
          formatRescheduleToast({
            post: selectedPost,
            datetime,
            verb: 'reagendado',
            currentWorkflowId,
          }),
        );
      } catch {
        toast.error('Erro ao reagendar post');
      }
    },
    [selectedPost, invalidateQueries, currentWorkflowId],
  );

  const handlePanelRemoveDate = useCallback(async () => {
    if (!selectedPost) return;
    const { id, workflow_id } = selectedPost;
    setSelectedPostId(null);
    try {
      await updateWorkflowPost(id, { scheduled_at: null });
      invalidateQueries(workflow_id);
      toast.success('Data removida do post');
    } catch {
      toast.error('Erro ao remover data do post');
    }
  }, [selectedPost, invalidateQueries]);

  const dismissHint = () => {
    setHintDismissed(true);
    localStorage.setItem('calendarHintDismissed.v2', 'true');
  };

  if (isLoading) {
    return <div className="drawer-empty">Carregando calendário...</div>;
  }

  return (
    <div className="workflow-calendar-view">
      {/* Hint banner */}
      {!hintDismissed && (
        <div className="calendar-hint-banner">
          <span className="calendar-hint-text">
            💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar —
            inclusive posts de outros workflows. Arraste de volta para remover a data (apenas posts
            deste workflow).
          </span>
          <button onClick={dismissHint} className="calendar-hint-close" aria-label="Fechar dica">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main content */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="calendar-content">
          <UnscheduledPostsSidebar posts={unscheduledPosts} currentWorkflowId={currentWorkflowId} />
          <div className="calendar-grid-container">
            <CalendarGrid
              currentMonth={currentMonth}
              scheduledPosts={scheduledPosts}
              currentWorkflowId={currentWorkflowId}
              selectedPostId={selectedPostId}
              onSelectPost={(post) => setSelectedPostId(post.id)}
              onMonthChange={setCurrentMonth}
            />
          </div>
          {selectedPost && (
            <CalendarPostDetailPanel
              key={selectedPost.id}
              post={selectedPost}
              hubUrl={hubUrl}
              membros={membros}
              isCurrentWorkflow={selectedIsCurrentWorkflow}
              isLocked={selectedIsLocked}
              lockReason={selectedIsLocked ? LOCKED_TOOLTIPS[selectedPost.status] : undefined}
              dayMarkers={detailDayMarkers}
              onClose={() => setSelectedPostId(null)}
              onReschedule={handlePanelReschedule}
              onRemoveDate={handlePanelRemoveDate}
              onOpenPost={() => onOpenPost?.(selectedPost.id)}
            />
          )}
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activePost && (
            <div className="drag-overlay-card">
              <span className="drag-overlay-tipo">{TIPO_LABELS[activePost.tipo]}</span>
              <span className="drag-overlay-title">{activePost.titulo || 'Post sem título'}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Time picker popover */}
      {pendingDrop && (
        <div className="time-picker-overlay">
          <TimePickerPopover
            date={pendingDrop.date}
            onConfirm={handleTimeConfirm}
            onCancel={handleTimeCancel}
            previousTime={pendingDrop.previousTime}
          />
        </div>
      )}
    </div>
  );
}
