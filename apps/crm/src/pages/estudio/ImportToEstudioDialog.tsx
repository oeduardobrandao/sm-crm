import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
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
import { importDesignFromMedia, DesignImportError } from '@/store';
import type { PostMedia } from '@/store';

// Slice C entry point: "Tornar editável no Estúdio" (design-import edge function). Explains
// what will happen (vision → inpaint background reconstruction → editable layers; consumes
// 1 image of the monthly AI quota) before spending it, then shows a long-running pending
// state (the pipeline can take up to ~2 minutes) that cannot be dismissed mid-flight. On
// success the new design is born HELD (media_apply_held) — ownership transfers on first save.

// Codes the dialog maps to a dedicated string. Any other/unknown code (or a network failure
// that never reached the server) falls back to a generic PT message — the server's own
// `error.message` is already PT and specific, so it is shown for all mapped codes too.
const KNOWN_CODES = new Set([
  'feature_disabled',
  'post_not_editable',
  'post_not_found',
  'post_tipo_unsupported',
  'post_has_video',
  'safety_refusal',
  'post_already_designed',
  'invalid_reference',
  'quota_exhausted',
  'rate_limited',
  'generation_in_progress',
  'vision_failed',
  'vision_unavailable',
  'normalize_failed',
  'compose_failed',
  'provider_error',
  'storage_error',
  'doc_too_large',
  'storage_quota_exceeded',
]);

export function ImportToEstudioDialog({
  postId,
  media,
  imageCount,
  postTipo,
  onClose,
}: {
  postId: number | null;
  media: PostMedia | null;
  /** Total image count on the post — drives the carrossel-specific copy ("as N imagens do
   * post viram páginas do design"). */
  imageCount: number;
  postTipo: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('estudio');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const open = postId !== null && media !== null;
  const isCarrossel = postTipo === 'carrossel';

  useEffect(() => {
    if (open) setErrorMessage(null);
  }, [open]);

  const importMutation = useMutation({
    mutationFn: () => importDesignFromMedia(postId!, media!.id),
    onSuccess: ({ design_id }) => {
      qc.invalidateQueries({ queryKey: ['post-design-summary', postId] });
      onClose();
      navigate(`/estudio/${design_id}`);
    },
    onError: (err: Error) => {
      if (err instanceof DesignImportError) {
        setErrorMessage(KNOWN_CODES.has(err.code) ? err.message : t('import.errors.generic'));
      } else {
        setErrorMessage(t('import.errors.network'));
      }
    },
  });

  const pending = importMutation.isPending;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        // Cannot be dismissed mid-flight (long-running: up to ~2 minutes).
        if (!o && !pending) onClose();
      }}
    >
      <AlertDialogContent style={{ maxWidth: 460 }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: 'var(--primary-hover)' }} />
            {t('import.title')}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <p>{t('import.explanation')}</p>
              <p>{t('import.quotaNote')}</p>
              {isCarrossel && <p>{t('import.carouselNote', { count: imageCount })}</p>}
              {pending && (
                <p
                  className="flex items-center gap-2"
                  style={{ color: 'var(--text-muted)' }}
                  data-testid="import-pending"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('import.pending')}
                </p>
              )}
              {errorMessage && (
                <p style={{ color: 'var(--danger)' }} data-testid="import-error">
                  {errorMessage}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('import.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              importMutation.mutate();
            }}
            data-testid="import-confirm"
          >
            {pending
              ? t('import.pendingCta')
              : errorMessage
                ? t('import.retry')
                : t('import.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
