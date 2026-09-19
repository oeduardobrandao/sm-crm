import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubPost } from '../types';

/**
 * Orchestrates "act on a post, then move to the next one" in the post detail dialog.
 *
 * One phase at a time, one owner for every timer:
 *
 *   idle
 *     |  confirm()            the client approved / sent a correction
 *   confirming               the badge sits on that post for CONFIRM_HOLD_MS; the card is
 *     |                       locked and rendered from a snapshot, so a list refetch cannot
 *     |                       pull it away mid-hold
 *     |  hold ends            navigate to the next pending post (or close), invalidate
 *   advancing                the outgoing card slides out while the incoming slides in
 *     |  SLIDE_MS             (manual prev/next enters here directly via advance())
 *   idle
 *
 * `onApprovalSubmitted` fires exactly once per confirm: when the hold ends, or earlier if
 * the hold is cancelled (Esc/X/scrim, URL cleared, or the URL moved to another post).
 */

export const CONFIRM_HOLD_MS = 3000;
export const SLIDE_MS = 400;

export type SlideDir = 'next' | 'prev';
export type ConfirmFlash = 'approved' | 'approvedScheduled' | 'correctionSent';

export type AdvancePhase =
  | { name: 'idle' }
  | {
      name: 'confirming';
      post: HubPost;
      /** The list as it was when the action was sent: counter and strip stay put during the hold. */
      posts: HubPost[];
      flash: ConfirmFlash;
      next: HubPost | null;
    }
  | {
      name: 'advancing';
      from: HubPost;
      fromPosts: HubPost[];
      to: number;
      dir: SlideDir;
      flash: ConfirmFlash | null;
    };

const IDLE: AdvancePhase = { name: 'idle' };

interface UsePostAdvanceOpts {
  posts: HubPost[];
  currentId: number | null;
  onNavigate: (postId: number | null) => void;
  onApprovalSubmitted: () => void;
}

/**
 * The post to move to once the hold ends. Prefers the one chosen when the action was
 * sent, as long as it is still pending in the live list; otherwise the first other pending
 * post; otherwise nothing (close).
 */
export function resolveNextPending(
  preferred: HubPost | null,
  posts: HubPost[],
  approvedId: number,
): HubPost | null {
  if (preferred && preferred.id !== approvedId) {
    const live = posts.find((p) => p.id === preferred.id);
    if (live && live.status === 'enviado_cliente') return live;
  }
  return posts.find((p) => p.id !== approvedId && p.status === 'enviado_cliente') ?? null;
}

export function usePostAdvance({
  posts,
  currentId,
  onNavigate,
  onApprovalSubmitted,
}: UsePostAdvanceOpts) {
  const [phase, setPhase] = useState<AdvancePhase>(IDLE);

  // Timer callbacks and cancel paths read the latest values without re-arming the timer.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const submittedRef = useRef(onApprovalSubmitted);
  submittedRef.current = onApprovalSubmitted;

  const confirm = useCallback((post: HubPost, flash: ConfirmFlash, next: HubPost | null) => {
    setPhase({ name: 'confirming', post, posts: postsRef.current, flash, next });
  }, []);

  const advance = useCallback((from: HubPost, to: number, dir: SlideDir) => {
    setPhase({ name: 'advancing', from, fromPosts: postsRef.current, to, dir, flash: null });
  }, []);

  /** Leaves `confirming` early without navigating; the pending list refresh still happens. */
  const cancelHold = useCallback(() => {
    if (phaseRef.current.name !== 'confirming') return;
    phaseRef.current = IDLE;
    setPhase(IDLE);
    submittedRef.current();
  }, []);

  // The hold: badge on the confirmed post, then move on.
  useEffect(() => {
    if (phase.name !== 'confirming') return;
    const id = window.setTimeout(() => {
      if (phaseRef.current !== phase) return;
      // The URL left this post during the hold (browser back, deep link): the client
      // already chose where to be, so only the refresh is still owed.
      if (currentIdRef.current !== phase.post.id) {
        phaseRef.current = IDLE;
        setPhase(IDLE);
        submittedRef.current();
        return;
      }
      const next = resolveNextPending(phase.next, postsRef.current, phase.post.id);
      if (next) {
        const advancing: AdvancePhase = {
          name: 'advancing',
          from: phase.post,
          fromPosts: phase.posts,
          to: next.id,
          dir: 'next',
          flash: phase.flash,
        };
        phaseRef.current = advancing;
        setPhase(advancing);
        navigateRef.current(next.id);
      } else {
        phaseRef.current = IDLE;
        setPhase(IDLE);
        navigateRef.current(null);
      }
      submittedRef.current();
    }, CONFIRM_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // The slide: drop the outgoing card once both animations have finished.
  useEffect(() => {
    if (phase.name !== 'advancing') return;
    const id = window.setTimeout(() => {
      if (phaseRef.current === phase) setPhase(IDLE);
    }, SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Dialog closed under us (URL cleared by Esc-less paths such as history navigation).
  useEffect(() => {
    if (currentId !== null) return;
    const current = phaseRef.current;
    if (current.name === 'idle') return;
    phaseRef.current = IDLE;
    setPhase(IDLE);
    if (current.name === 'confirming') submittedRef.current();
  }, [currentId]);

  return { phase, confirm, advance, cancelHold };
}
