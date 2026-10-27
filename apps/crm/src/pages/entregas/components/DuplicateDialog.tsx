import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { clonePost, cloneWorkflow } from '@/store';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';

/** O que está sendo duplicado. `status` (post) decide se o aviso de
 *  reagendar aparece; `active` (fluxo) decide se o toast do chamador oferece
 *  "Abrir" (fluxo concluído/arquivado não aparece no quadro ativo).
 *  `postsCount` null = contagem desconhecida (estatísticas ainda carregando, ou
 *  o fluxo sem linha nelas): o diálogo mostra uma linha neutra. */
export type DuplicateTarget =
  | { kind: 'post'; postId: number; status: string }
  | { kind: 'workflow'; workflowId: number; postsCount: number | null; active: boolean };

const PUBLISH_STATES = new Set(['agendado', 'postado', 'falha_publicacao']);

export function duplicateErrorMessage(err: unknown): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  return i18n.t('workflows:duplicateDialog.error');
}

function postsLine(n: number | null): string {
  if (n === null) return i18n.t('workflows:duplicateDialog.postsAll');
  if (n === 0) return i18n.t('workflows:duplicateDialog.postsNone');
  if (n === 1) return i18n.t('workflows:duplicateDialog.postsOne');
  return i18n.t('workflows:duplicateDialog.postsMany', { n });
}

interface DuplicateDialogProps {
  target: DuplicateTarget | null;
  onClose: () => void;
  onDuplicated: (newId: number, target: DuplicateTarget) => void;
}

export function DuplicateDialog({ target, onClose, onDuplicated }: DuplicateDialogProps) {
  const { t } = useTranslation('workflows');
  const [mode, setMode] = useState<'keep' | 'rascunho'>('keep');
  const [pending, setPending] = useState(false);
  // O texto segue o último alvo não nulo: ao fechar, `target` vira null antes
  // da animação de saída acabar e o título trocaria de "post" para "fluxo".
  const lastTargetRef = useRef<DuplicateTarget | null>(target);
  if (target) lastTargetRef.current = target;
  const shown = target ?? lastTargetRef.current;

  // Cada abertura começa no padrão.
  useEffect(() => {
    if (target) setMode('keep');
  }, [target]);

  const isPost = shown?.kind === 'post';
  const showKeepHelp = shown ? !isPost || PUBLISH_STATES.has(shown.status) : false;

  const submit = async () => {
    if (!target || pending) return;
    setPending(true);
    try {
      const toRascunho = mode === 'rascunho';
      const newId =
        target.kind === 'post'
          ? await clonePost(target.postId, toRascunho)
          : await cloneWorkflow(target.workflowId, toRascunho);
      onDuplicated(newId, target);
      onClose();
    } catch (err) {
      toast.error(duplicateErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const option = (value: 'keep' | 'rascunho', label: string, help?: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
      <input
        type="radio"
        name="duplicate-mode"
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
        disabled={pending}
        className="mt-1"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {help && <span className="block text-xs text-muted-foreground">{help}</span>}
      </span>
    </label>
  );

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            {isPost ? t('duplicateDialog.titlePost') : t('duplicateDialog.titleFlow')}
          </DialogTitle>
          <DialogDescription>
            {shown?.kind === 'workflow'
              ? postsLine(shown.postsCount)
              : t('duplicateDialog.postDesc')}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t('duplicateDialog.statusAria')} className="space-y-2">
          {option(
            'keep',
            isPost ? t('duplicateDialog.keepPost') : t('duplicateDialog.keepFlow'),
            showKeepHelp ? t('duplicateDialog.keepHelp') : undefined,
          )}
          {option(
            'rascunho',
            isPost ? t('duplicateDialog.draftPost') : t('duplicateDialog.draftFlow'),
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? t('duplicateDialog.duplicating') : t('duplicateDialog.duplicate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
