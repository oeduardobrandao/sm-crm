import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubPost } from '../../types';
import { CONFIRM_HOLD_MS, resolveNextPending, SLIDE_MS, usePostAdvance } from '../usePostAdvance';

function post(over: Partial<HubPost>): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

const A = post({ id: 1 });
const B = post({ id: 2, status: 'aprovado_cliente' });
const C = post({ id: 3 });
const posts = [A, B, C];

function setup(initial: { posts?: HubPost[]; currentId?: number | null } = {}) {
  const onNavigate = vi.fn();
  const onApprovalSubmitted = vi.fn();
  const calls: string[] = [];
  onNavigate.mockImplementation((id) => calls.push(`navigate:${id}`));
  onApprovalSubmitted.mockImplementation(() => calls.push('invalidate'));
  const hook = renderHook(
    (props: { posts: HubPost[]; currentId: number | null }) =>
      usePostAdvance({ ...props, onNavigate, onApprovalSubmitted }),
    { initialProps: { posts: initial.posts ?? posts, currentId: initial.currentId ?? 1 } },
  );
  return { ...hook, onNavigate, onApprovalSubmitted, calls };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('usePostAdvance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle', () => {
    const { result } = setup();
    expect(result.current.phase).toEqual({ name: 'idle' });
  });

  it('confirm holds the badge for CONFIRM_HOLD_MS, then navigates to the next pending post and invalidates', async () => {
    const { result, rerender, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    expect(result.current.phase).toMatchObject({ name: 'confirming', post: A, flash: 'approved' });

    await tick(CONFIRM_HOLD_MS - 1);
    expect(result.current.phase.name).toBe('confirming');
    expect(calls).toEqual([]);

    await tick(1);
    expect(result.current.phase).toMatchObject({
      name: 'advancing',
      from: A,
      to: 3,
      dir: 'next',
      flash: 'approved',
    });
    // The list refresh is owed only once the card has moved on.
    expect(calls).toEqual(['navigate:3', 'invalidate']);

    // The URL follows; the slide runs for SLIDE_MS, then the outgoing card is dropped.
    rerender({ posts, currentId: 3 });
    await tick(SLIDE_MS - 1);
    expect(result.current.phase.name).toBe('advancing');
    await tick(1);
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual(['navigate:3', 'invalidate']);
  });

  it('closes instead of sliding when no other pending post remains', async () => {
    const { result, calls } = setup({ posts: [A, B] });
    act(() => result.current.confirm(A, 'correctionSent', null));
    await tick(CONFIRM_HOLD_MS);
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual(['navigate:null', 'invalidate']);
  });

  it('snapshots the list at confirm time so a refetch mid-hold does not touch the held card', async () => {
    const { result, rerender } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    rerender({ posts: [B, C], currentId: 1 });
    expect(result.current.phase).toMatchObject({ name: 'confirming', posts });
  });

  it('re-resolves the target at hold end against the live list', async () => {
    const D = post({ id: 4 });
    const { result, rerender, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    // C was approved elsewhere meanwhile; D is the only pending post left.
    rerender({ posts: [A, B, post({ id: 3, status: 'aprovado_cliente' }), D], currentId: 1 });
    await tick(CONFIRM_HOLD_MS);
    expect(calls).toEqual(['navigate:4', 'invalidate']);
  });

  it('cancelHold leaves the hold early, invalidates once and never navigates', async () => {
    const { result, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    act(() => result.current.cancelHold());
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual(['invalidate']);
    act(() => result.current.cancelHold());
    await tick(CONFIRM_HOLD_MS + SLIDE_MS);
    expect(calls).toEqual(['invalidate']);
  });

  it('cancelHold outside the hold is a no-op', () => {
    const { result, calls } = setup();
    act(() => result.current.cancelHold());
    expect(calls).toEqual([]);
    act(() => result.current.advance(A, 3, 'next'));
    act(() => result.current.cancelHold());
    expect(result.current.phase.name).toBe('advancing');
    expect(calls).toEqual([]);
  });

  it('a dialog closed by the URL during the hold still invalidates, once, without navigating', async () => {
    const { result, rerender, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    rerender({ posts, currentId: null });
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual(['invalidate']);
    await tick(CONFIRM_HOLD_MS);
    expect(calls).toEqual(['invalidate']);
  });

  it('a URL that moved to another post during the hold is respected: invalidate only, no stale navigate', async () => {
    const { result, rerender, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    rerender({ posts, currentId: 2 });
    await tick(CONFIRM_HOLD_MS);
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual(['invalidate']);
  });

  it('a second confirm during the hold restarts it with the new post', async () => {
    const { result, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    await tick(2000);
    act(() => result.current.confirm(A, 'approvedScheduled', C));
    await tick(2000);
    expect(result.current.phase).toMatchObject({ name: 'confirming', flash: 'approvedScheduled' });
    expect(calls).toEqual([]);
    await tick(1000);
    expect(calls).toEqual(['navigate:3', 'invalidate']);
  });

  it('advance slides without a hold or an invalidate, in the given direction', async () => {
    const { result, rerender, calls } = setup({ currentId: 2 });
    act(() => result.current.advance(B, 1, 'prev'));
    expect(result.current.phase).toMatchObject({
      name: 'advancing',
      from: B,
      to: 1,
      dir: 'prev',
      flash: null,
    });
    rerender({ posts, currentId: 1 });
    await tick(SLIDE_MS);
    expect(result.current.phase).toEqual({ name: 'idle' });
    expect(calls).toEqual([]);
  });

  it('a new advance mid-slide restarts the slide from the card that was entering', async () => {
    const { result, rerender } = setup();
    act(() => result.current.advance(A, 3, 'next'));
    rerender({ posts, currentId: 3 });
    await tick(SLIDE_MS / 2);
    act(() => result.current.advance(C, 2, 'prev'));
    rerender({ posts, currentId: 2 });
    expect(result.current.phase).toMatchObject({ name: 'advancing', from: C, to: 2, dir: 'prev' });
    await tick(SLIDE_MS / 2);
    expect(result.current.phase.name).toBe('advancing');
    await tick(SLIDE_MS / 2);
    expect(result.current.phase).toEqual({ name: 'idle' });
  });

  it('clears its timers on unmount', async () => {
    const { result, unmount, calls } = setup();
    act(() => result.current.confirm(A, 'approved', C));
    unmount();
    await tick(CONFIRM_HOLD_MS + SLIDE_MS);
    expect(calls).toEqual([]);
  });
});

describe('resolveNextPending', () => {
  it('keeps the preferred post while it is still pending', () => {
    expect(resolveNextPending(C, posts, 1)).toBe(C);
  });
  it('falls back to the first other pending post when the preferred one is gone or no longer pending', () => {
    const D = post({ id: 4 });
    expect(resolveNextPending(C, [A, B, D], 1)).toBe(D);
    expect(resolveNextPending(C, [A, B, post({ id: 3, status: 'postado' }), D], 1)).toBe(D);
    expect(resolveNextPending(null, [A, B, D], 1)).toBe(D);
  });
  it('never picks the post that was just acted on, and returns null when nothing is pending', () => {
    expect(resolveNextPending(null, [A, B], 1)).toBeNull();
    expect(resolveNextPending(A, [A, B], 1)).toBeNull();
  });
});
