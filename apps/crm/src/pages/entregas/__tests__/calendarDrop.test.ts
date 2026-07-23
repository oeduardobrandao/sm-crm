import { describe, expect, it } from 'vitest';
import { resolveCalendarDrop, formatRescheduleToast } from '../calendarDrop';
import type { ClientePost } from '@/store/posts';

function mkPost(over: Partial<ClientePost> = {}): ClientePost {
  return {
    id: 1,
    workflow_id: 10,
    titulo: 'Post',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: null,
    ordem: 0,
    workflow_titulo: 'WF',
    ...over,
  };
}

describe('resolveCalendarDrop', () => {
  it('is a noop when there is no post or no drop target', () => {
    expect(
      resolveCalendarDrop({ post: undefined, overId: 'date-2026-07-24', currentWorkflowId: 10 }),
    ).toEqual({ kind: 'noop' });
    expect(
      resolveCalendarDrop({ post: mkPost(), overId: undefined, currentWorkflowId: 10 }),
    ).toEqual({ kind: 'noop' });
  });

  it('unschedules an own scheduled post dropped on the sidebar', () => {
    const post = mkPost({ scheduled_at: '2026-07-20T13:00:00.000Z' });
    expect(
      resolveCalendarDrop({ post, overId: 'unscheduled-zone', currentWorkflowId: 10 }),
    ).toEqual({ kind: 'unschedule' });
  });

  it('is a noop when an already-unscheduled post is dropped on the sidebar', () => {
    expect(
      resolveCalendarDrop({ post: mkPost(), overId: 'unscheduled-zone', currentWorkflowId: 10 }),
    ).toEqual({ kind: 'noop' });
  });

  it('rejects unscheduling a post owned by another workflow', () => {
    const post = mkPost({ workflow_id: 99, scheduled_at: '2026-07-20T13:00:00.000Z' });
    expect(
      resolveCalendarDrop({ post, overId: 'unscheduled-zone', currentWorkflowId: 10 }),
    ).toEqual({ kind: 'reject-foreign-unschedule' });
  });

  it('schedules a post dropped on a date cell, with no previous time', () => {
    const result = resolveCalendarDrop({
      post: mkPost(),
      overId: 'date-2026-07-24',
      currentWorkflowId: 10,
    });
    expect(result).toEqual({ kind: 'schedule', date: new Date(2026, 6, 24) });
  });

  it('carries the previous time forward when rescheduling', () => {
    const post = mkPost({ scheduled_at: '2026-07-20T13:45:00.000Z' });
    const prev = new Date('2026-07-20T13:45:00.000Z');
    const result = resolveCalendarDrop({
      post,
      overId: 'date-2026-07-24',
      currentWorkflowId: 10,
    });
    expect(result).toEqual({
      kind: 'schedule',
      date: new Date(2026, 6, 24),
      previousTime: { hour: prev.getHours(), minute: prev.getMinutes() },
    });
  });

  it('allows rescheduling a post owned by another workflow', () => {
    const post = mkPost({ workflow_id: 99, scheduled_at: '2026-07-20T13:00:00.000Z' });
    const result = resolveCalendarDrop({ post, overId: 'date-2026-07-24', currentWorkflowId: 10 });
    expect(result.kind).toBe('schedule');
  });

  it('is a noop for an unrecognised drop target', () => {
    expect(
      resolveCalendarDrop({ post: mkPost(), overId: 'something-else', currentWorkflowId: 10 }),
    ).toEqual({ kind: 'noop' });
  });
});

describe('formatRescheduleToast', () => {
  const datetime = new Date(2026, 6, 24, 20, 0);

  it('does not name the workflow for an own post', () => {
    expect(
      formatRescheduleToast({
        post: mkPost(),
        datetime,
        verb: 'reagendado',
        currentWorkflowId: 10,
      }),
    ).toBe('Post reagendado para 24/07/2026 às 20:00');
  });

  it('names the owning workflow for a foreign post', () => {
    expect(
      formatRescheduleToast({
        post: mkPost({ workflow_id: 99, workflow_titulo: 'Agosto — Carrosséis' }),
        datetime,
        verb: 'reagendado',
        currentWorkflowId: 10,
      }),
    ).toBe('Post de «Agosto — Carrosséis» reagendado para 24/07/2026 às 20:00');
  });

  it('uses the agendado verb for a first-time schedule', () => {
    expect(
      formatRescheduleToast({
        post: mkPost(),
        datetime,
        verb: 'agendado',
        currentWorkflowId: 10,
      }),
    ).toBe('Post agendado para 24/07/2026 às 20:00');
  });

  it('falls back to the plain form when the post is missing', () => {
    expect(
      formatRescheduleToast({
        post: undefined,
        datetime,
        verb: 'reagendado',
        currentWorkflowId: 10,
      }),
    ).toBe('Post reagendado para 24/07/2026 às 20:00');
  });

  it('zero-pads single-digit times', () => {
    expect(
      formatRescheduleToast({
        post: mkPost(),
        datetime: new Date(2026, 6, 5, 9, 5),
        verb: 'agendado',
        currentWorkflowId: 10,
      }),
    ).toContain('às 09:05');
  });
});
