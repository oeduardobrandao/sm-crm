import { parseISO } from 'date-fns';
import type { ClientePost } from '@/store/posts';

export type CalendarDropResult =
  | { kind: 'noop' }
  | { kind: 'unschedule' }
  | { kind: 'reject-foreign-unschedule' }
  | { kind: 'schedule'; date: Date; previousTime?: { hour: number; minute: number } };

/**
 * Decides what a calendar drag-end means. Pure: no toasts, no mutations.
 *
 * Rescheduling is allowed for any unlocked post, including posts owned by other
 * workflows. Unscheduling stays scoped to the current workflow, because the
 * sidebar only lists this workflow's backlog — an unscheduled foreign post would
 * drop out of every visible surface.
 */
export function resolveCalendarDrop({
  post,
  overId,
  currentWorkflowId,
}: {
  post: ClientePost | undefined;
  overId: string | undefined;
  currentWorkflowId: number;
}): CalendarDropResult {
  if (!post || !overId) return { kind: 'noop' };

  if (overId === 'unscheduled-zone') {
    if (!post.scheduled_at) return { kind: 'noop' };
    if (post.workflow_id !== currentWorkflowId) return { kind: 'reject-foreign-unschedule' };
    return { kind: 'unschedule' };
  }

  if (overId.startsWith('date-')) {
    const [y, m, d] = overId.replace('date-', '').split('-').map(Number);
    const date = new Date(y, m - 1, d);

    if (!post.scheduled_at) return { kind: 'schedule', date };

    const prev = parseISO(post.scheduled_at);
    return {
      kind: 'schedule',
      date,
      previousTime: { hour: prev.getHours(), minute: prev.getMinutes() },
    };
  }

  return { kind: 'noop' };
}

/**
 * Success copy for both reschedule paths (drag-drop confirm and the detail panel picker).
 * Names the owning workflow when the post isn't ours, so the user knows what they touched.
 * A missing post (deleted in another tab mid-flow) degrades to the plain form.
 */
export function formatRescheduleToast({
  post,
  datetime,
  verb,
  currentWorkflowId,
}: {
  post: Pick<ClientePost, 'workflow_id' | 'workflow_titulo'> | undefined;
  datetime: Date;
  verb: 'agendado' | 'reagendado';
  currentWorkflowId: number;
}): string {
  const hh = String(datetime.getHours()).padStart(2, '0');
  const mm = String(datetime.getMinutes()).padStart(2, '0');
  const when = `${datetime.toLocaleDateString('pt-BR')} às ${hh}:${mm}`;
  const owner =
    post && post.workflow_id !== currentWorkflowId ? `Post de «${post.workflow_titulo}»` : 'Post';
  return `${owner} ${verb} para ${when}`;
}
