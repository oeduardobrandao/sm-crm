import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { hasPendingEditSuggestion, type WorkflowPost } from '../../../store/posts';
import { STATUS_LABELS } from '../postLabels';

type PostStatus = WorkflowPost['status'];

/**
 * Canonical targets that put a post on the way out: from `aprovado_cliente` the approval-exit
 * automation can schedule it, and `agendado` / `postado` publish it. Moving there while the
 * client's suggestion is still unreviewed would bury it.
 */
const GUARDED_TARGETS: ReadonlySet<PostStatus> = new Set([
  'aprovado_cliente',
  'agendado',
  'postado',
]);

/**
 * One guarded action for every manual CRM move into `aprovado_cliente`, `agendado` or
 * `postado`: when the post has a pending client suggestion, asks before the write.
 *
 * `targetCanonical` is the canonical status the move lands on (a custom status passes its
 * `behaves_as`). `currentCanonical`, when the caller has it, lets a move that does not change
 * the canonical status skip the prompt (a no-op, like `statusChangeNeedsConfirm`). Call it
 * AFTER any existing confirm of the surface (the "post aprovado" one), never instead of it.
 * Resolves `true` at once when the target is not guarded or nothing is pending; otherwise
 * opens the dialog and resolves with the user's choice. If the lookup itself fails it
 * resolves `true` (the team's move must not depend on a head count) and logs a warning, so
 * a broken grant does not disable the guard silently.
 *
 * Render `dialog` once in the surface. A second call while one is open cancels the first.
 */
export function useSuggestionMoveGuard(): {
  confirmMove: (
    postId: number,
    targetCanonical: PostStatus,
    currentCanonical?: PostStatus,
  ) => Promise<boolean>;
  dialog: JSX.Element;
} {
  const { t } = useTranslation('postEditor');
  const [target, setTarget] = useState<PostStatus | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);
  // Keeps the title filled while the dialog fades out after `target` is cleared.
  const shownTarget = useRef<PostStatus | null>(null);
  if (target) shownTarget.current = target;

  const settle = useCallback((ok: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setTarget(null);
    resolve?.(ok);
  }, []);

  // An unmounted surface can no longer act on the answer: release the awaiting caller.
  useEffect(() => () => settle(false), [settle]);

  const confirmMove = useCallback(
    async (
      postId: number,
      targetCanonical: PostStatus,
      currentCanonical?: PostStatus,
    ): Promise<boolean> => {
      if (!GUARDED_TARGETS.has(targetCanonical)) return true;
      if (currentCanonical === targetCanonical) return true;
      let pending: boolean;
      try {
        pending = await hasPendingEditSuggestion(postId);
      } catch (err) {
        console.warn('useSuggestionMoveGuard: pending suggestion lookup failed', err);
        return true;
      }
      if (!pending) return true;
      settle(false);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setTarget(targetCanonical);
      });
    },
    [settle],
  );

  const dialog = (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('suggestionReview.moveGuard.title', {
              status: shownTarget.current ? STATUS_LABELS[shownTarget.current] : '',
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('suggestionReview.moveGuard.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('suggestionReview.moveGuard.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            {t('suggestionReview.moveGuard.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmMove, dialog };
}
