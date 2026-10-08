import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
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
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { deletePostReference, type ReferenceItem } from '@/store/postReferences';
import { ReferenceTile } from './ReferenceTile';
import { referenceLabel } from './referenceFormat';

export interface PostClientReferencesProps {
  postId: number;
  /** From PostEditorBody's single `usePostReferences` call. */
  references: ReferenceItem[];
  /** Opens the editor's viewer dialog (images and videos). */
  onOpen: (item: ReferenceItem) => void;
}

/** "Referências do cliente": what the client attached in the Hub. Read-only for the team
 *  except for deletion; renders nothing when there are none (the team cannot add). */
export function PostClientReferences({ postId, references, onOpen }: PostClientReferencesProps) {
  const qc = useQueryClient();
  const headingId = useId();
  const { can } = useAuth();
  // Same gate as post-references DELETE (hasPermissionFor entregas/editar). 'unknown' while the
  // membership loads hides the trash instead of offering a delete that would 403.
  const canDelete = can('entregas', 'editar') === true;
  const [pendingDelete, setPendingDelete] = useState<ReferenceItem | null>(null);

  const removal = useMutation({
    mutationFn: (id: number) => deletePostReference(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-references', postId] });
      // Prefix: the drawer keys counts by workflow id, which this section does not know.
      qc.invalidateQueries({ queryKey: ['post-reference-counts'] });
      toast.success('Referência excluída');
    },
    onError: (err) => {
      toast.error(
        err instanceof Error && err.message === 'forbidden'
          ? 'Você não tem permissão para excluir referências.'
          : 'Não foi possível excluir a referência. Tente novamente.',
      );
    },
  });
  useUnsavedWork(removal.isPending);

  if (references.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Paperclip className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        <h4 id={headingId} className="text-[13px] font-semibold text-[var(--text-main)]">
          Referências do cliente
        </h4>
        <Badge variant="info" size="sm">
          {references.length}
        </Badge>
        <span className="text-[12px] text-[var(--text-light)]">Enviadas pelo Hub</span>
      </header>

      <ul className="grid grid-cols-3 gap-3 min-[900px]:grid-cols-4">
        {references.map((item) => (
          <li key={item.id} className="min-w-0">
            <ReferenceTile
              item={item}
              canDelete={canDelete}
              onOpen={onOpen}
              onDeleteRequest={setPendingDelete}
            />
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir referência?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${referenceLabel(pendingDelete)} sai deste post para a equipe e para o cliente. Não dá para desfazer.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) removal.mutate(pendingDelete.id);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
