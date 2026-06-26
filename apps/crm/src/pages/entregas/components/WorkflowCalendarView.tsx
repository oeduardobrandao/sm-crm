import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { parseISO } from 'date-fns';
import { X } from 'lucide-react';
import { getClientePosts, updateWorkflowPost, type ClientePost, type Membro } from '@/store';
import { CalendarGrid, LOCKED_STATUSES, LOCKED_TOOLTIPS } from './CalendarGrid';
import { CalendarPostDetailPanel } from './CalendarPostDetailPanel';
import { UnscheduledPostsSidebar } from './UnscheduledPostsSidebar';
import { TimePickerPopover } from './TimePickerPopover';

const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

interface WorkflowCalendarViewProps {
  clienteId: number;
  clienteNome: string;
  currentWorkflowId: number;
  currentWorkflowTitulo: string;
  onBack: () => void;
  membros?: Membro[];
  onOpenPost?: (postId: number) => void;
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
}: WorkflowCalendarViewProps) {
  const qc = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [activePost, setActivePost] = useState<ClientePost | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem('calendarHintDismissed') === 'true',
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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

  const invalidateQueries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', currentWorkflowId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  }, [qc, clienteId, currentWorkflowId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const post = event.active.data.current?.post as ClientePost | undefined;
    setActivePost(post ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActivePost(null);
      const { active, over } = event;
      if (!over) return;

      const post = active.data.current?.post as ClientePost | undefined;
      if (!post) return;

      const overId = String(over.id);

      // Dropped on unscheduled zone → unschedule
      if (overId === 'unscheduled-zone') {
        if (!post.scheduled_at) return; // already unscheduled
        try {
          await updateWorkflowPost(post.id, { scheduled_at: null });
          invalidateQueries();
          toast.success('Data removida do post');
        } catch {
          toast.error('Erro ao remover data do post');
        }
        return;
      }

      // Dropped on a date cell
      if (overId.startsWith('date-')) {
        const dateStr = overId.replace('date-', '');
        const [y, m, d] = dateStr.split('-').map(Number);
        const dropDate = new Date(y, m - 1, d);

        // Get previous time if rescheduling
        let previousTime: { hour: number; minute: number } | undefined;
        if (post.scheduled_at) {
          const prev = parseISO(post.scheduled_at);
          previousTime = { hour: prev.getHours(), minute: prev.getMinutes() };
        }

        setPendingDrop({ postId: post.id, date: dropDate, previousTime });
      }
    },
    [invalidateQueries],
  );

  const handleTimeConfirm = useCallback(
    async (datetime: Date) => {
      if (!pendingDrop) return;
      try {
        await updateWorkflowPost(pendingDrop.postId, { scheduled_at: datetime.toISOString() });
        invalidateQueries();
        const isReschedule = pendingDrop.previousTime != null;
        toast.success(
          isReschedule
            ? `Post reagendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`
            : `Post agendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`,
        );
      } catch {
        toast.error('Erro ao agendar post');
      } finally {
        setPendingDrop(null);
      }
    },
    [pendingDrop, invalidateQueries],
  );

  const handleTimeCancel = useCallback(() => {
    setPendingDrop(null);
  }, []);

  const handlePanelReschedule = useCallback(
    async (datetime: Date) => {
      if (!selectedPostId) return;
      try {
        await updateWorkflowPost(selectedPostId, { scheduled_at: datetime.toISOString() });
        invalidateQueries();
        toast.success(
          `Post reagendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`,
        );
      } catch {
        toast.error('Erro ao reagendar post');
      }
    },
    [selectedPostId, invalidateQueries],
  );

  const handlePanelRemoveDate = useCallback(async () => {
    if (!selectedPostId) return;
    const id = selectedPostId;
    setSelectedPostId(null);
    try {
      await updateWorkflowPost(id, { scheduled_at: null });
      invalidateQueries();
      toast.success('Data removida do post');
    } catch {
      toast.error('Erro ao remover data do post');
    }
  }, [selectedPostId, invalidateQueries]);

  const dismissHint = () => {
    setHintDismissed(true);
    localStorage.setItem('calendarHintDismissed', 'true');
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
            💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar. Arraste
            de volta para remover a data.
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
        <div className={`calendar-content${selectedPost ? ' calendar-content--with-panel' : ''}`}>
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
              membros={membros}
              isCurrentWorkflow={selectedIsCurrentWorkflow}
              isLocked={selectedIsLocked}
              lockReason={selectedIsLocked ? LOCKED_TOOLTIPS[selectedPost.status] : undefined}
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
