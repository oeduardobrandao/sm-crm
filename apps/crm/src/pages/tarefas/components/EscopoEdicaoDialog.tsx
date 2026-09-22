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

export interface EscopoEdicaoDialogProps {
  open: boolean;
  /** "Somente esta" is disabled when the rule section changed. */
  regraAlterada: boolean;
  saving: boolean;
  onSomenteEsta: () => void;
  onEstaEProximas: () => void;
  onCancel: () => void;
}

/** "Aplicar a quais tarefas?" (spec: Scope dialogs > Edit). Triggered only by
 *  saving the Editar form of an occurrence; inline actions never prompt. */
export function EscopoEdicaoDialog({
  open,
  regraAlterada,
  saving,
  onSomenteEsta,
  onEstaEProximas,
  onCancel,
}: EscopoEdicaoDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aplicar a quais tarefas?</AlertDialogTitle>
          <AlertDialogDescription>
            As próximas tarefas criadas usarão estas alterações. Tarefas que já existem não mudam.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {regraAlterada && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            A regra de repetição vale para toda a série.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // keep Radix from auto-closing before the async save resolves;
              // the parent closes the dialog
              e.preventDefault();
              onSomenteEsta();
            }}
            disabled={regraAlterada || saving}
          >
            Somente esta
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onEstaEProximas();
            }}
            disabled={saving}
          >
            Esta e as próximas
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
