import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  getDiscussaoParticipacao,
  markDiscussaoLida,
  sendDiscussaoMessage,
  setDiscussaoSeguindo,
  type CommentThreadWithComments,
  type DiscussaoParticipacao,
} from '@/store/comments';

/** How long the section must stay visible before the read marker moves. */
const MARK_READ_DELAY_MS = 800;
/** Share of the section that must be on screen to count as "seen". */
const VISIBLE_RATIO = 0.5;
/** PostgREST/Realtime `in.(...)` filters break past 100 values. */
const MAX_FILTER_IDS = 100;

const THREADS_KEY = ['post-comment-threads'] as const;
const NAO_LIDAS_KEY = ['post-discussao-nao-lidas'] as const;
const participacaoKey = (postId: number) => ['post-discussao-participacao', postId] as const;

export interface UseDiscussaoArgs {
  postId: number;
  /** This post's threads (general + passage), from the drawer's query. */
  threads: CommentThreadWithComments[];
  currentUserId: string;
  /**
   * False while the post row is collapsed (PostEditorBody mounts for every row of the
   * drawer): no participation fetch, no realtime channel, no read marker. Default true.
   */
  enabled?: boolean;
}

export interface UseDiscussaoResult {
  participacao: DiscussaoParticipacao | undefined;
  /** Follows the post (`seguindo`) or is its responsible without a row yet (`implicito`). */
  isParticipant: boolean;
  /** Others' comments above the read marker across all the post's threads. 0 for non-participants. */
  naoLidas: number;
  /** The read marker as it was when the section opened, for the "Não lidas" divider. */
  unreadAnchorId: number | null;
  /** Rejects when the send fails; the caller keeps the draft. */
  send: (content: string) => Promise<void>;
  sending: boolean;
  toggleSeguir: () => Promise<void>;
  /** Attach to the section root: the read marker advances while it is on screen. */
  sectionRef: (el: HTMLElement | null) => void;
}

export function useDiscussao({
  postId,
  threads,
  currentUserId,
  enabled = true,
}: UseDiscussaoArgs): UseDiscussaoResult {
  const qc = useQueryClient();

  const participacaoQuery = useQuery({
    queryKey: participacaoKey(postId),
    queryFn: () => getDiscussaoParticipacao(postId),
    refetchOnWindowFocus: 'always',
    enabled,
  });
  const participacao = participacaoQuery.data;
  const isParticipant = !!participacao && (participacao.seguindo || participacao.implicito);
  const lastSeen = participacao?.lastSeenCommentId ?? 0;

  const maxCommentId = useMemo(() => {
    let max = 0;
    for (const t of threads) for (const c of t.post_comments) if (c.id > max) max = c.id;
    return max;
  }, [threads]);

  const naoLidas = useMemo(() => {
    if (!isParticipant) return 0;
    let n = 0;
    for (const t of threads) {
      for (const c of t.post_comments) {
        if (c.id > lastSeen && c.author_id !== currentUserId) n++;
      }
    }
    return n;
  }, [threads, isParticipant, lastSeen, currentUserId]);

  // Read marker as of the first fresh load for this post. It must not follow the live
  // marker, or the "Não lidas" divider would vanish the moment the section is read.
  const [anchor, setAnchor] = useState<{ postId: number; id: number } | null>(null);
  const hasFreshParticipacao = participacaoQuery.isFetchedAfterMount && !!participacao;
  useEffect(() => {
    // Collapsing the post ends the "open" session: the next expand takes a new anchor.
    if (!enabled) {
      setAnchor(null);
      return;
    }
    if (!hasFreshParticipacao || !participacao) return;
    // A bystander has no marker (the RPC answers 0). Everything loaded when they opened
    // counts as seen, so if they follow or write later only newer messages land under
    // "Não lidas" instead of the whole history.
    const captured = isParticipant ? participacao.lastSeenCommentId : maxCommentId;
    setAnchor((prev) => (prev && prev.postId === postId ? prev : { postId, id: captured }));
  }, [enabled, hasFreshParticipacao, participacao, isParticipant, maxCommentId, postId]);
  const anchorReady = !!anchor && anchor.postId === postId;
  const unreadAnchorId = anchorReady && isParticipant ? anchor.id : null;

  // ── Realtime ────────────────────────────────────────────────
  const threadIdsKey = useMemo(
    () =>
      threads
        .map((t) => t.id)
        .sort((a, b) => a - b)
        .slice(-MAX_FILTER_IDS)
        .join(','),
    [threads],
  );

  // realtime-js reuses a channel whose topic is still in its list, and a channel only
  // leaves that list on the server's leave ack. Rebuilding under the same topic (the thread
  // set changed) would get the leaving channel back and its subscribe() would be a no-op,
  // so every subscription gets its own topic.
  const channelSeqRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const onChange = () => {
      void qc.invalidateQueries({ queryKey: THREADS_KEY });
      void qc.invalidateQueries({ queryKey: NAO_LIDAS_KEY });
    };
    channelSeqRef.current += 1;
    let channel = supabase.channel(`post-discussao-${postId}-${channelSeqRef.current}`).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'post_comment_threads',
        filter: `post_id=eq.${postId}`,
      },
      onChange,
    );
    if (threadIdsKey) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_comments',
          filter: `thread_id=in.(${threadIdsKey})`,
        },
        onChange,
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, postId, threadIdsKey, qc]);

  // Refetch when the window regains focus (a DELETE by someone else has no filterable
  // event, so this is also how it shows up).
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => {
      void qc.invalidateQueries({ queryKey: THREADS_KEY });
      void qc.invalidateQueries({ queryKey: NAO_LIDAS_KEY });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, qc]);

  // ── Visibility -> read marker ───────────────────────────────
  const [sectionEl, setSectionEl] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const sectionRef = useCallback((el: HTMLElement | null) => setSectionEl(el), []);

  useEffect(() => {
    if (!sectionEl || typeof IntersectionObserver === 'undefined') {
      setVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setVisible(last.isIntersecting && last.intersectionRatio >= VISIBLE_RATIO);
      },
      { threshold: [VISIBLE_RATIO] },
    );
    observer.observe(sectionEl);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, [sectionEl]);

  // A hidden tab stops IntersectionObserver callbacks, so `visible` would stay true while
  // realtime keeps raising maxCommentId: never mark read while the document is hidden.
  const [docVisible, setDocVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    const onVisibility = () => setDocVisible(document.visibilityState === 'visible');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Highest id already sent for the post in view; never goes backward within a post.
  const lastSentRef = useRef<{ postId: number; id: number }>({ postId, id: 0 });
  useEffect(() => {
    // Reading must not turn a bystander into a participant: only participants get a marker.
    // Waiting for the anchor keeps a mark from racing the open-time participation fetch
    // (whose answer would otherwise freeze the already-advanced marker as the anchor).
    if (!enabled || !visible || !docVisible || !anchorReady || !isParticipant) return;
    if (maxCommentId <= 0) return;
    if (lastSentRef.current.postId !== postId) lastSentRef.current = { postId, id: 0 };
    if (maxCommentId <= Math.max(lastSentRef.current.id, lastSeen)) return;
    const timer = setTimeout(() => {
      lastSentRef.current = { postId, id: maxCommentId };
      markDiscussaoLida(postId, maxCommentId)
        .then(() => {
          void qc.invalidateQueries({ queryKey: participacaoKey(postId) });
          void qc.invalidateQueries({ queryKey: NAO_LIDAS_KEY });
        })
        .catch(() => {
          // Let the next change (or re-entry into view) retry this id.
          if (lastSentRef.current.postId === postId && lastSentRef.current.id === maxCommentId) {
            lastSentRef.current = { postId, id: 0 };
          }
        });
    }, MARK_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    enabled,
    visible,
    docVisible,
    anchorReady,
    isParticipant,
    maxCommentId,
    lastSeen,
    postId,
    qc,
  ]);

  // ── Mutations ───────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (content: string) => sendDiscussaoMessage(postId, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: THREADS_KEY });
      void qc.invalidateQueries({ queryKey: NAO_LIDAS_KEY });
      // Sending enrols the author, so the participation row changed too.
      void qc.invalidateQueries({ queryKey: participacaoKey(postId) });
    },
  });
  const { mutateAsync: sendAsync } = sendMutation;
  const send = useCallback(
    async (content: string) => {
      await sendAsync(content);
    },
    [sendAsync],
  );

  const seguirMutation = useMutation({
    mutationFn: (seguir: boolean) => setDiscussaoSeguindo(postId, seguir),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: participacaoKey(postId) });
      void qc.invalidateQueries({ queryKey: NAO_LIDAS_KEY });
    },
  });
  const { mutateAsync: seguirAsync } = seguirMutation;
  // The implicit responsible (no row yet) already gets notices, so for them the bell
  // reads "Seguindo" and a click unfollows: isParticipant is the "following" state.
  const hasParticipacao = !!participacao;
  const toggleSeguir = useCallback(async () => {
    if (!hasParticipacao) return;
    await seguirAsync(!isParticipant);
  }, [hasParticipacao, isParticipant, seguirAsync]);

  return {
    participacao,
    isParticipant,
    naoLidas,
    unreadAnchorId,
    send,
    sending: sendMutation.isPending,
    toggleSeguir,
    sectionRef,
  };
}
