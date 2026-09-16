import { useState, useRef, useCallback, useMemo } from 'react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { submitEditSuggestion } from '../api';
import type { HubPost, PendingEditSuggestion } from '../types';

export type SaveState = 'idle' | 'saving' | 'saved';

interface UseEditSuggestionOpts {
  token: string;
  post: HubPost;
  onSaved: () => void;
}

export function useEditSuggestion({ token, post, onSaved }: UseEditSuggestionOpts) {
  const isEditable = post.status === 'enviado_cliente';
  const suggestion = post.pending_suggestion;
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // At most one submitEditSuggestion call in flight at a time. Without this, two
  // debounced saves can overlap (the edge function round-trip is several sequential
  // DB calls, easily 0.5-1.5s) and complete out of order: an earlier, staler snapshot
  // can land AFTER a later, more complete one and silently overwrite it. A flush in
  // flight is followed by another flush of whatever is left queued once it settles,
  // so saves are strictly serialized and each one reflects the freshest state at send
  // time -- per post, see below.
  //
  // `pendingRef` is a Map keyed by post id, not a single slot. This component/hook
  // instance can be reused across different posts without remounting (e.g.
  // `postagens/:postId` has no `key`, so React Router re-renders the same instance on
  // navigation) -- a single-slot queue would let editing post C overwrite a still-queued
  // edit for post B, silently dropping B's edit even though it was typed into a
  // different post and never got a chance to send. Keying by post id keeps each post's
  // latest edit (repeated edits to the same post still coalesce onto one entry) until
  // it is actually sent.
  type Payload = {
    postId: number;
    conteudo: Record<string, unknown> | null;
    conteudoPlain: string;
    igCaption: string | null;
  };
  const pendingRef = useRef<Map<number, Payload>>(new Map());
  const inFlightRef = useRef(false);
  // The specific post id `flush` has already dequeued and is currently awaiting a
  // response for. `flush` removes an entry from `pendingRef` BEFORE awaiting its
  // request (so a newer edit to that same post, made while it's in flight, queues
  // cleanly instead of colliding with it) -- which means `pendingRef.current.has(id)`
  // alone can't tell "queued" apart from "in flight, entry already removed". Anything
  // that needs to know whether a post has outstanding work (queued OR in flight) must
  // check both; `hasOutstandingWork` below is that single check.
  const inFlightPostIdRef = useRef<number | null>(null);
  const hasOutstandingWork = (postId: number) =>
    pendingRef.current.has(postId) || inFlightPostIdRef.current === postId;

  const [saveState, setSaveState] = useState<SaveState>(() =>
    hasOutstandingWork(post.id) ? 'saving' : 'idle',
  );
  const [hasPendingSuggestion, setHasPendingSuggestion] = useState(!!suggestion);
  const [dirty, setDirty] = useState(() => hasOutstandingWork(post.id));

  const draftConteudo = useMemo(
    () => suggestion?.suggested_conteudo ?? post.conteudo,
    [suggestion, post.conteudo],
  );
  const draftConteudoPlain = useMemo(
    () => suggestion?.suggested_conteudo_plain ?? post.conteudo_plain,
    [suggestion, post.conteudo_plain],
  );
  const draftIgCaption = useMemo(
    () => suggestion?.suggested_ig_caption ?? post.ig_caption ?? null,
    [suggestion, post.ig_caption],
  );

  // Always holds the id of whichever post this hook is CURRENTLY rendering. `flush`
  // uses it to decide whether a just-drained save's outcome should update this
  // instance's on-screen state (saveState/hasPendingSuggestion/dirty): a save for a
  // post the user has since navigated away from must still be sent (below), but must
  // not paint the CURRENTLY displayed post's UI with a different post's result.
  const currentPostIdRef = useRef(post.id);
  if (currentPostIdRef.current !== post.id) {
    // Navigated to a different post (`postagens/:postId` has no `key`, so React
    // Router reuses this same component/hook instance instead of remounting it on
    // navigation). This is React's documented pattern for resetting state in response
    // to a prop change during render: without it, a save still in flight for the post
    // just left would correctly never touch this hook's state once it resolves (the
    // freshness check in `flush`, below) -- but then nothing EVER clears the
    // 'saving'/dirty state left over from that post, leaving the NEWLY displayed post
    // stuck permanently "saving" with its approval blocked. Resetting here makes this
    // instance immediately reflect the incoming post's own true status: still-queued
    // work for it (from an earlier visit) shows as saving/dirty, a fresh post shows
    // idle/clean.
    currentPostIdRef.current = post.id;
    setSaveState(hasOutstandingWork(post.id) ? 'saving' : 'idle');
    setDirty(hasOutstandingWork(post.id));
    setHasPendingSuggestion(!!suggestion);
    // The cosmetic "saved -> idle" timer belongs to the post being left; if left
    // running, it would fire later and could stomp the newly-displayed post's own,
    // legitimately different saveState (e.g. flipping it from 'saving' to 'idle'
    // mid-save). The debounce timer (`timerRef`) is deliberately NOT cleared here --
    // it's the pending autosave for the post being left, which must still fire.
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }

  // An explicit drain loop rather than recursion: a queued edit made while this was
  // already running (another `saveSuggestion` call landing mid-`await`) is handled by
  // looping back to `pendingRef` instead of calling `flush` again, so there is only
  // ever one closure involved -- nothing about it can go stale mid-drain.
  const flush = useCallback(async () => {
    if (inFlightRef.current || pendingRef.current.size === 0) return;
    inFlightRef.current = true;
    // The completion side effects (saveState/hasPendingSuggestion/dirty) are applied
    // once, AFTER the loop below has fully drained -- not per iteration. A second edit
    // to the currently-displayed post made while its first save is in flight coalesces
    // onto the SAME map entry and gets picked up by the next loop iteration; applying
    // "saved"/dirty=false right after the FIRST response would be premature (that
    // newer edit hasn't been sent yet) and, if the newer send then fails, would leave
    // `dirty` stuck at false with no signal that the latest edit was never saved.
    let currentPostOutcome: {
      postId: number;
      succeeded: boolean;
      pendingSuggestion: unknown;
    } | null = null;
    try {
      while (pendingRef.current.size > 0) {
        const [postId, payload] = pendingRef.current.entries().next().value as [number, Payload];
        pendingRef.current.delete(postId);
        const isCurrentPost = postId === currentPostIdRef.current;
        if (isCurrentPost) setSaveState('saving');
        inFlightPostIdRef.current = postId;
        try {
          const res = await submitEditSuggestion(
            token,
            payload.postId,
            payload.conteudo,
            payload.conteudoPlain,
            payload.igCaption,
          );
          onSaved();
          if (isCurrentPost) {
            currentPostOutcome = {
              postId,
              succeeded: true,
              pendingSuggestion: res.pending_suggestion,
            };
          }
        } catch {
          if (isCurrentPost)
            currentPostOutcome = { postId, succeeded: false, pendingSuggestion: null };
        } finally {
          inFlightPostIdRef.current = null;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
    // Re-check against the freshest current post id: it may have changed again while
    // the loop above was still draining (further navigation), in which case this
    // outcome is no longer about whatever is on screen and must not touch its UI.
    if (currentPostOutcome && currentPostOutcome.postId === currentPostIdRef.current) {
      if (currentPostOutcome.succeeded) {
        setHasPendingSuggestion(!!currentPostOutcome.pendingSuggestion);
        setSaveState('saved');
        setDirty(false);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
      } else {
        // Swallowed on purpose, so `dirty` is the only signal left that the edit
        // never made it to the server: it stays true (set in saveSuggestion, never
        // cleared here).
        setSaveState('idle');
      }
    }
  }, [token, onSaved]);

  const saveSuggestion = useCallback(
    (conteudo: Record<string, unknown> | null, conteudoPlain: string, igCaption: string | null) => {
      setDirty(true);
      pendingRef.current.set(post.id, { postId: post.id, conteudo, conteudoPlain, igCaption });
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

      timerRef.current = setTimeout(() => {
        flush();
      }, 1500);
    },
    [flush, post.id],
  );

  const approvalBlocked = saveState === 'saving' || hasPendingSuggestion;
  const wasRejected = !hasPendingSuggestion && !!post.suggestion_rejected_at;

  useUnsavedWork(dirty || saveState === 'saving');

  return {
    isEditable,
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    draftConteudo,
    draftConteudoPlain,
    draftIgCaption,
  };
}
