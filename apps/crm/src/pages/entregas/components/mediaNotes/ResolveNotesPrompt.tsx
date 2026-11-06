import { useRef } from 'react';
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

/**
 * Asked after a slide or video is replaced or removed: the open notes on it (the client's
 * and the team's internal ones) no longer point at what was reviewed, so the team can
 * close them in one go.
 */
export function ResolveNotesPrompt({
  open,
  count,
  kind = 'image',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  /** What was replaced or removed, for the wording. */
  kind?: 'image' | 'video';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // The action button also closes the dialog (onOpenChange(false)): that close must not
  // be reported as a cancel after the confirm already ran.
  const confirmed = useRef(false);
  const { t } = useTranslation('posts');
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              kind === 'video' ? 'resolveNotesPrompt.titleVideo' : 'resolveNotesPrompt.titleSlide',
              { count },
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('resolveNotesPrompt.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('resolveNotesPrompt.notNow')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true;
              onConfirm();
            }}
          >
            {t('resolveNotesPrompt.confirm', { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
