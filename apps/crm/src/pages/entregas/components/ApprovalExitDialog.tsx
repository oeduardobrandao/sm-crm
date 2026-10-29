import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  /** Posts that the bulk approval would move and that still carry a client suggestion nobody
   *  reviewed. The line shows only above zero; absent or 0 keeps the dialog as it was. */
  pendingSuggestionCount?: number;
  locked?: boolean;
  busy?: boolean;
  /** A busca das contagens falhou: aviso inline com "Tentar de novo". */
  countsError?: boolean;
  onRetry?: () => void;
  /** Muda quando o chamador quer o sheet do celular de volta depois de uma escolha
   *  que não fechou o diálogo (posts_changed, nova tentativa): o sheet se esconde
   *  sozinho ao escolher, e só uma remontagem o mostra de novo. */
  sessionKey?: string | number;
  onConfirm: (choice: ApprovalExitOption) => void;
  onCancel: () => void;
}

function optionCopy(
  t: TFunction<'workflows'>,
  option: ApprovalExitOption,
  isPost: boolean,
  n: ApprovalExitDialogProps['numbers'],
): { title: string; description: string } {
  switch (option) {
    case 'manter':
      return isPost
        ? { title: t('approvalExit.keepPostTitle'), description: t('approvalExit.keepPostDesc') }
        : { title: t('approvalExit.keepFlowTitle'), description: t('approvalExit.keepFlowDesc') };
    case 'aprovar':
      return isPost
        ? {
            title: t('approvalExit.approvePostTitle'),
            description: t('approvalExit.approvePostDesc'),
          }
        : {
            title: t('approvalExit.approveFlowTitle'),
            description: t('approvalExit.approveFlowDesc', { count: n.pendentes }),
          };
    case 'voltar_rascunho':
      return isPost
        ? {
            title: t('approvalExit.draftPostTitle'),
            description: t('approvalExit.draftPostDesc'),
          }
        : {
            title: t('approvalExit.draftFlowTitle'),
            description: t('approvalExit.draftFlowDesc', { count: n.alteraveisRascunho }),
          };
    case 'enviar_portal':
      return isPost
        ? {
            title: t('approvalExit.sendPortal'),
            description: t('approvalExit.sendPortalPostDesc'),
          }
        : {
            title: t('approvalExit.sendPortal'),
            description: t('approvalExit.sendPortalFlowDesc', { count: n.aprovadoInterno }),
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
  pendingSuggestionCount = 0,
  locked,
  busy,
  countsError,
  onRetry,
  sessionKey,
  onConfirm,
  onCancel,
}: ApprovalExitDialogProps) {
  const { t } = useTranslation('workflows');
  const isPost = entityKind === 'post';
  const isPhone = !useIsDesktop(768);
  const groupId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  // A escolha do usuário, zerada só quando o diálogo abre. Sem escolha (ou com uma
  // que deixou de ser oferecida) vale a recomendada: assim uma recarga das
  // contagens (posts_changed) nunca troca o que o usuário marcou.
  const [picked, setPicked] = useState<ApprovalExitOption | null>(null);
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);
  const selected: ApprovalExitOption =
    picked !== null && options.includes(picked) ? picked : recommended;
  // Quando as contagens chegam a recomendada pode mudar sob o foco: leva o foco
  // junto, para nunca haver um rádio focado e outro marcado. Só age com o foco já
  // no grupo, então não rouba o foco de Cancelar.
  useEffect(() => {
    const group = groupRef.current;
    const active = document.activeElement;
    if (!group || !(active instanceof HTMLInputElement) || !group.contains(active)) return;
    if (active.value === selected) return;
    group.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
  }, [selected]);

  const title =
    nextEtapaName === null
      ? t('approvalExit.titleComplete', { title: entityTitle })
      : t('approvalExit.titleAdvance', { title: entityTitle, next: nextEtapaName });
  const intro = isPost ? t('approvalExit.introPost') : t('approvalExit.introFlow');
  const advanceLabel =
    nextEtapaName === null ? t('approvalExit.complete') : t('approvalExit.advance');
  const primaryLabel = selected === 'enviar_portal' ? t('approvalExit.sendPortal') : advanceLabel;
  const countsErrorText = t('approvalExit.countsError');
  const safetyNote = t('approvalExit.safetyNote');
  const disabled = counts === null || !!busy;
  const suggestionLine =
    pendingSuggestionCount > 0
      ? t('approvalExit.pendingSuggestions', { count: pendingSuggestionCount })
      : null;

  const chips = counts
    ? (Object.entries(counts) as [WorkflowPost['status'], number | undefined][])
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([status, n]) => ({
          status,
          label: isPost
            ? STATUS_LABELS[status]
            : t('approvalExit.statusChip', { label: STATUS_LABELS[status], n }),
        }))
    : [];

  if (isPhone) {
    const ordered = locked
      ? (['manter'] as ApprovalExitOption[])
      : [recommended, ...options.filter((o) => o !== recommended)];
    // Description do sheet é um <p>: só spans aqui dentro.
    const message = locked ? (
      t('approvalExit.keepPostDesc')
    ) : countsError ? (
      countsErrorText
    ) : (
      <>
        <span className="block">{intro}</span>
        {suggestionLine && <span className="mt-2 block text-xs font-medium">{suggestionLine}</span>}
        {chips.length > 0 && (
          <span
            className="mt-2 flex flex-wrap justify-center gap-1.5"
            aria-label={t('approvalExit.currentStatuses')}
          >
            {chips.map((c) => (
              <span
                key={c.status}
                className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
              >
                {c.label}
              </span>
            ))}
          </span>
        )}
        <span className="mt-2 block text-xs">{safetyNote}</span>
      </>
    );
    if (countsError && !locked) {
      return (
        <PhoneConfirmSheet
          key={sessionKey}
          open={open}
          title={title}
          message={message}
          actions={[{ label: t('approvalExit.retry'), onSelect: () => onRetry?.() }]}
          onCancel={onCancel}
        />
      );
    }
    return (
      <PhoneConfirmSheet
        key={sessionKey}
        open={open}
        title={title}
        message={message}
        actions={ordered.map((opt) => {
          const copy = optionCopy(t, opt, isPost, numbers);
          const label = locked
            ? advanceLabel
            : opt === recommended
              ? t('approvalExit.recommendedSuffix', { title: copy.title })
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
      <DialogContent
        onOpenAutoFocus={(e) => {
          // O foco inicial vai para o rádio marcado (a recomendada), não para o
          // primeiro da lista.
          const checked = groupRef.current?.querySelector<HTMLInputElement>(
            'input[type="radio"]:checked',
          );
          if (checked) {
            e.preventDefault();
            checked.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {locked ? (
          <p className="text-sm text-muted-foreground">{t('approvalExit.keepPostDesc')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{intro}</p>
            {suggestionLine && (
              <p className="text-sm font-medium text-foreground">{suggestionLine}</p>
            )}
            {chips.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t('approvalExit.currentStatuses')}>
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
            {countsError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-[var(--danger-text)]"
              >
                <span>{countsErrorText}</span>
                <Button variant="outline" size="sm" onClick={() => onRetry?.()}>
                  {t('approvalExit.retry')}
                </Button>
              </div>
            )}
            <div
              ref={groupRef}
              role="radiogroup"
              aria-label={t('approvalExit.whatHappens')}
              className="flex flex-col gap-2"
            >
              {options.map((opt) => {
                const copy = optionCopy(t, opt, isPost, numbers);
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
                      onChange={() => setPicked(opt)}
                      className="mt-1 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        {copy.title}
                        {opt === recommended && (
                          <span className="rounded-md bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">
                            {t('approvalExit.recommended')}
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
            <p className="text-xs text-muted-foreground">{safetyNote}</p>
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={() => onConfirm(locked ? 'manter' : selected)} disabled={disabled}>
            {locked ? advanceLabel : primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
