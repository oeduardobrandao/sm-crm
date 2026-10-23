import { useRef } from 'react';
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
  const where = kind === 'video' ? 'deste vídeo' : 'deste slide';
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
            {count === 1
              ? `Marcar como resolvido o comentário ${where}?`
              : `Marcar como resolvidos os ${count} comentários ${where}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vale para os comentários do cliente e para as notas internas. Todos continuam no
            histórico do post.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Agora não</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true;
              onConfirm();
            }}
          >
            {count === 1 ? 'Marcar como resolvido' : 'Marcar como resolvidos'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
