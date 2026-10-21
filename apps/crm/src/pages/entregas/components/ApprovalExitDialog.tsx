import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { PostStatusCounts, WorkflowPost } from '@/store/posts';
import { STATUS_LABELS } from '../postLabels';
import type { ApprovalExitOption } from '../approvalExit';
import { ChoiceLabel, PhoneConfirmSheet } from '../phone/PhoneConfirmSheet';

export interface ApprovalExitDialogProps {
  open: boolean;
  entityKind: 'fluxo' | 'post';
  entityTitle: string;
  /** null = o avanço conclui o fluxo/processo. */
  nextEtapaName: string | null;
  /** null = carregando. */
  counts: PostStatusCounts | null;
  options: ApprovalExitOption[];
  recommended: ApprovalExitOption;
  numbers: { pendentes: number; alteraveisRascunho: number; aprovadoInterno: number };
  locked?: boolean;
  busy?: boolean;
  onConfirm: (choice: ApprovalExitOption) => void;
  onCancel: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function optionCopy(
  option: ApprovalExitOption,
  isPost: boolean,
  n: ApprovalExitDialogProps['numbers'],
): { title: string; description: string } {
  switch (option) {
    case 'manter':
      return isPost
        ? { title: 'Manter status', description: 'O status do post não muda.' }
        : { title: 'Manter status atuais', description: 'Nenhum post muda.' };
    case 'aprovar':
      return isPost
        ? { title: 'Aprovar', description: 'O post fica aprovado pela equipe.' }
        : {
            title: 'Aprovar todos',
            description: `${plural(n.pendentes, 'post pendente fica', 'posts pendentes ficam')} aprovado${n.pendentes === 1 ? '' : 's'} pela equipe.`,
          };
    case 'voltar_rascunho':
      return isPost
        ? {
            title: 'Voltar para rascunho',
            description: 'O post volta para rascunho. O histórico de aprovações é mantido.',
          }
        : {
            title: 'Voltar todos para rascunho',
            description: `${plural(n.alteraveisRascunho, 'post volta', 'posts voltam')} para rascunho. O histórico de aprovações é mantido.`,
          };
    case 'enviar_portal':
      return isPost
        ? {
            title: 'Enviar ao portal',
            description: 'O post vai para o cliente aprovar. O processo não avança.',
          }
        : {
            title: 'Enviar ao portal',
            description: `${plural(n.aprovadoInterno, 'post aprovado internamente vai', 'posts aprovados internamente vão')} para o cliente aprovar. O fluxo não avança.`,
          };
  }
}

export function ApprovalExitDialog({
  open,
  entityKind,
  entityTitle,
  nextEtapaName,
  counts,
  options,
  recommended,
  numbers,
  locked,
  busy,
  onConfirm,
  onCancel,
}: ApprovalExitDialogProps) {
  const isPost = entityKind === 'post';
  const isPhone = !useIsDesktop(768);
  const groupId = useId();
  const [selected, setSelected] = useState<ApprovalExitOption>(recommended);
  useEffect(() => {
    if (open) setSelected(recommended);
  }, [open, recommended]);

  const title =
    nextEtapaName === null
      ? `Concluir "${entityTitle}"?`
      : `Avançar "${entityTitle}" para ${nextEtapaName}?`;
  const intro = isPost
    ? 'Este post está saindo de uma etapa de aprovação. Escolha o que acontece com ele.'
    : 'Este fluxo está saindo de uma etapa de aprovação. Escolha o que acontece com os posts.';
  const advanceLabel = nextEtapaName === null ? 'Concluir' : 'Avançar';
  const primaryLabel = selected === 'enviar_portal' ? 'Enviar ao portal' : advanceLabel;
  const disabled = counts === null || !!busy;

  const chips = counts
    ? (Object.entries(counts) as [WorkflowPost['status'], number | undefined][])
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([status, n]) => ({
          status,
          label: isPost ? STATUS_LABELS[status] : `${STATUS_LABELS[status]}: ${n}`,
        }))
    : [];

  if (isPhone) {
    const ordered = locked
      ? (['manter'] as ApprovalExitOption[])
      : [recommended, ...options.filter((o) => o !== recommended)];
    return (
      <PhoneConfirmSheet
        open={open}
        title={title}
        message={locked ? 'O status do post não muda.' : intro}
        actions={ordered.map((opt) => {
          const copy = optionCopy(opt, isPost, numbers);
          const label = locked
            ? advanceLabel
            : opt === recommended
              ? `${copy.title} (Recomendado)`
              : copy.title;
          return {
            label: locked ? (
              advanceLabel
            ) : (
              <ChoiceLabel title={label} description={copy.description} />
            ),
            onSelect: () => onConfirm(opt),
            disabled,
          };
        })}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {locked ? (
          <p className="text-sm text-muted-foreground">O status do post não muda.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{intro}</p>
            {chips.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Status atuais">
                {chips.map((c) => (
                  <li
                    key={c.status}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                  >
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <div role="radiogroup" aria-label="O que acontece" className="flex flex-col gap-2">
              {options.map((opt) => {
                const copy = optionCopy(opt, isPost, numbers);
                const checked = selected === opt;
                return (
                  <label
                    key={opt}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring ${
                      checked ? 'border-primary border-2 bg-accent' : 'border-border bg-background'
                    }`}
                  >
                    <input
                      type="radio"
                      name={groupId}
                      value={opt}
                      checked={checked}
                      onChange={() => setSelected(opt)}
                      className="mt-1 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        {copy.title}
                        {opt === recommended && (
                          <span className="rounded-md bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">
                            Recomendado
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {copy.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Posts agendados ou publicados nunca são alterados.
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(locked ? 'manter' : selected)} disabled={disabled}>
            {locked ? advanceLabel : primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
