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
 * Asked after a slide is replaced or removed: the client's open notes on it no longer
 * point at what the client saw, so the team can close them in one go.
 */
export function ResolveNotesPrompt({
  open,
  count,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1
              ? 'Marcar como resolvido o comentário deste slide?'
              : `Marcar como resolvidos os ${count} comentários deste slide?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Os comentários do cliente continuam no histórico do post.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Agora não</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Marcar como resolvidos</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
