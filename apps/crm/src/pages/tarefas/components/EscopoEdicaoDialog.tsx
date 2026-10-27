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
  const { t } = useTranslation('tasksForm');
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('escopoEdicao.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('escopoEdicao.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        {regraAlterada && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('escopoEdicao.ruleWholeSeries')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // keep Radix from auto-closing before the async save resolves;
              // the parent closes the dialog
              e.preventDefault();
              onSomenteEsta();
            }}
            disabled={regraAlterada || saving}
          >
            {t('escopoEdicao.onlyThis')}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onEstaEProximas();
            }}
            disabled={saving}
          >
            {t('escopoEdicao.thisAndFollowing')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
