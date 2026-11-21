import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  CommentsApiError,
  commentsErrorMessage,
  deleteComment,
  setCommentHidden,
  type IgComment,
  type PostCommentsResponse,
} from '../../../services/instagramComments';

/** One reload after the last delete, to pick up replies Instagram removed with it and the
 *  new count. Every reload spends the workspace's comment-read budget, so never per action. */
const RELOAD_DEBOUNCE_MS = 5000;

function setHiddenInCache(
  qc: QueryClient,
  queryKey: unknown[],
  id: string,
  hidden: boolean,
  onlyIf?: boolean,
) {
  qc.setQueryData<PostCommentsResponse>(queryKey, (old) =>
    old
      ? {
          ...old,
          comments: old.comments.map((c) =>
            c.id === id && (onlyIf === undefined || (c.hidden === true) === onlyIf)
              ? { ...c, hidden }
              : c,
          ),
        }
      : old,
  );
}

function isGone(e: unknown): boolean {
  return (
    e instanceof CommentsApiError &&
    (e.code === 'comment_not_found' || e.code === 'comment_unavailable')
  );
}

/**
 * Hide / show / delete for the comments of one post, against the
 * `['ig-post-comments', clientId, postId]` cache. Hide is optimistic (rolled back on error);
 * delete only touches the cache after the server confirms. `hide` and `remove` never reject:
 * errors become a toast. They may run after the panel unmounts (the toast's "Desfazer"),
 * so they only use the query client, the service and the ids captured at call time.
 */
export function useCommentModeration({
  clientId,
  postId,
  queryKey,
}: {
  clientId: number;
  postId: string;
  queryKey: unknown[];
}): {
  pending: ReadonlySet<string>;
  hide(c: IgComment, hidden: boolean): Promise<void>;
  remove(c: IgComment): Promise<void>;
} {
  const { t } = useTranslation('analyticsComments');
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // State drives rendering; the ref makes a second synchronous call for the same id a no-op.
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Key of the pending debounced reload, for the unmount cleanup.
  const reloadKey = useRef<unknown[] | null>(null);

  // `qc` is stable, so this runs once: the cleanup is the unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
        // The locally filtered list (stale counts, 5 min staleTime) must not be served as
        // fresh on the next open; mark it stale without spending a fetch now.
        if (reloadKey.current) {
          void qc.invalidateQueries({ queryKey: reloadKey.current, refetchType: 'none' });
        }
      }
    };
  }, [qc]);

  // A silent deploy swap waits while a moderation call is in flight.
  useUnsavedWork(pending.size > 0);

  const sync = () => {
    if (mounted.current) setPending(new Set(inFlight.current));
  };
  const begin = (id: string): boolean => {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    sync();
    return true;
  };
  const end = (id: string) => {
    inFlight.current.delete(id);
    sync();
  };

  const cancelScheduledReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = null;
  };
  const reloadNow = (key: unknown[]) => {
    cancelScheduledReload();
    void qc.invalidateQueries({ queryKey: key });
  };
  const scheduleReload = (key: unknown[]) => {
    // Unmounted: just mark the list stale (no fetch for an inactive query); the next open
    // of the tab reads it fresh.
    if (!mounted.current) {
      void qc.invalidateQueries({ queryKey: key });
      return;
    }
    cancelScheduledReload();
    reloadKey.current = key;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void qc.invalidateQueries({ queryKey: key });
    }, RELOAD_DEBOUNCE_MS);
  };

  const fail = (e: unknown, key: unknown[]) => {
    // The comment is gone or out of reach on Instagram: never drop it locally on our own,
    // reload the list instead (once, spending the read budget a pending debounce would).
    if (isGone(e)) reloadNow(key);
    toast.error(commentsErrorMessage(e, t));
  };

  const hide = async (c: IgComment, hidden: boolean): Promise<void> => {
    const key = queryKey;
    const id = c.id;
    if (!begin(id)) return;
    setHiddenInCache(qc, key, id, hidden);
    try {
      await setCommentHidden(clientId, postId, id, hidden);
      // A reload that landed while the call was in flight may have read the old state.
      setHiddenInCache(qc, key, id, hidden);
      toast(t(hidden ? 'moderation.hidden' : 'moderation.shown'), {
        action: { label: t('moderation.undo'), onClick: () => void hide(c, !hidden) },
      });
    } catch (e) {
      // Flip back only this comment, and only if nothing (a reload) replaced it meanwhile.
      setHiddenInCache(qc, key, id, !hidden, hidden);
      fail(e, key);
    } finally {
      end(id);
    }
  };

  const remove = async (c: IgComment): Promise<void> => {
    const key = queryKey;
    const id = c.id;
    if (!begin(id)) return;
    try {
      await deleteComment(clientId, postId, id);
      qc.setQueryData<PostCommentsResponse>(key, (old) =>
        old
          ? { ...old, comments: old.comments.filter((x) => x.id !== id && x.parent_id !== id) }
          : old,
      );
      toast(t('moderation.deleted'));
      scheduleReload(key);
    } catch (e) {
      fail(e, key);
    } finally {
      end(id);
    }
  };

  return { pending, hide, remove };
}
