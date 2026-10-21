import { useState } from 'react';
import { X } from 'lucide-react';
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

export interface RascunhoBannerProps {
  count: number;
  entityKind: 'fluxo' | 'post';
  busy?: boolean;
  onReset: () => void;
  onDismiss: () => void;
}

export function RascunhoBanner({
  count,
  entityKind,
  busy,
  onReset,
  onDismiss,
}: RascunhoBannerProps) {
  const [confirming, setConfirming] = useState(false);
  const isPost = entityKind === 'post';
  const headline = isPost
    ? 'Este post continua aprovado.'
    : count === 1
      ? '1 post continua aprovado.'
      : `${count} posts continuam aprovados.`;
  const detail = isPost
    ? 'A próxima etapa de aprovação vai precisar dele em rascunho para enviar ao cliente de novo.'
    : 'A próxima etapa de aprovação vai precisar deles em rascunho para enviar ao cliente de novo.';
  const confirmTitle = isPost
    ? 'Voltar o post para rascunho?'
    : `Voltar ${count} ${count === 1 ? 'post' : 'posts'} para rascunho?`;
  const confirmBody = `${isPost ? 'Ele sai' : 'Eles saem'} de Aprovado e voltam para Rascunho. O histórico de aprovações é mantido.`;

  return (
    <>
      <div className="rascunho-banner" role="status">
        <div className="rascunho-banner__text">
          <strong>{headline}</strong>
          <span>{detail}</span>
        </div>
        <button
          type="button"
          className="rascunho-banner__action"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {isPost ? 'Voltar para rascunho' : 'Voltar todos para rascunho'}
        </button>
        <button
          type="button"
          className="rascunho-banner__close"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onReset();
              }}
            >
              Voltar para rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
