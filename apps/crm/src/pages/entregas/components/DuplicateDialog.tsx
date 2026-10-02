import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
const KEEP_HELP =
  'Posts agendados, postados ou com falha voltam para Aprovado pelo cliente. A data fica, mas é preciso agendar de novo.';

export function duplicateErrorMessage(err: unknown): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  return 'Não foi possível duplicar. Tente novamente.';
}

function postsLine(n: number | null): string {
  if (n === null) return 'Todos os posts do fluxo serão copiados com a mídia.';
  if (n === 0) return 'O fluxo não tem posts. Só as etapas serão copiadas.';
  if (n === 1) return 'O post do fluxo será copiado com a mídia.';
  return `Os ${n} posts do fluxo serão copiados com a mídia.`;
}

interface DuplicateDialogProps {
  target: DuplicateTarget | null;
  onClose: () => void;
  onDuplicated: (newId: number, target: DuplicateTarget) => void;
}

export function DuplicateDialog({ target, onClose, onDuplicated }: DuplicateDialogProps) {
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
          <DialogTitle>{isPost ? 'Duplicar post' : 'Duplicar fluxo'}</DialogTitle>
          <DialogDescription>
            {shown?.kind === 'workflow'
              ? postsLine(shown.postsCount)
              : 'A cópia leva conteúdo, legendas, mídia e propriedades.'}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Status da cópia" className="space-y-2">
          {option(
            'keep',
            isPost ? 'Manter status atual' : 'Manter status atuais',
            showKeepHelp ? KEEP_HELP : undefined,
          )}
          {option('rascunho', isPost ? 'Mudar para Rascunho' : 'Mudar tudo para Rascunho')}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Duplicando...' : 'Duplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
