import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  detachPostsFromWorkflow,
  detachPostsKeepingProcess,
  type DetachKeepingProcessResult,
  type DetachPostsResult,
} from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import { buildFingerprint } from '../fingerprint';
import { buildDetachDeadlines } from '../detachDeadlines';
import { getPostProcessErrorToast } from '../postProcessErrors';

export interface DetachPostsDialogProps {
  open: boolean;
  onClose: () => void;
  card: BoardCard;
  posts: { id: number; titulo: string | null }[];
  isTotalSelection: boolean;
  /** features?.feature_post_processes === true: the ONLY flag read in this dialog. */
  keepStepsEnabled: boolean;
  onDetachedWithoutProcess: (result: DetachPostsResult, archived: boolean) => void;
  onDetachedKeepingProcess: (result: DetachKeepingProcessResult, archived: boolean) => void;
}

export function newRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Spec §5.1: manter etapas exige fluxo ativo com exatamente uma etapa ativa,
 *  e um prazo congelável para ela (senão a RPC responde active_deadline_required). */
export function keepStepsAvailability(
  card: BoardCard,
  activeDeadline: string | null,
): { available: boolean; reason?: string } {
  if (card.workflow.status !== 'ativo')
    return { available: false, reason: i18n.t('workflows:detachDialog.notActive') };
  const ativas = card.allEtapas.filter((e) => e.status === 'ativo').length;
  if (ativas !== 1)
    return { available: false, reason: i18n.t('workflows:detachDialog.inconsistent') };
  if (!activeDeadline)
    return { available: false, reason: i18n.t('workflows:detachDialog.noDeadline') };
  return { available: true };
}

type Mode = 'manter' | 'avulso';

export function DetachPostsDialog({
  open,
  onClose,
  card,
  posts,
  isTotalSelection,
  keepStepsEnabled,
  onDetachedWithoutProcess,
  onDetachedKeepingProcess,
}: DetachPostsDialogProps) {
  const { t } = useTranslation('workflows');
  const deadlines = useMemo(() => buildDetachDeadlines(card.allEtapas, card.etapa), [card]);
  const availability = keepStepsAvailability(card, deadlines.activeDeadline);
  const keepAvailable = keepStepsEnabled && availability.available;
  const [mode, setMode] = useState<Mode>('manter');
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const postIdsKey = posts.map((p) => p.id).join(',');
  // Spec §9.4 + fase 2 (input_hash): novo id sempre que a entrada muda.
  const [requestId, setRequestId] = useState(newRequestId);
  useEffect(() => {
    setRequestId(newRequestId());
  }, [open, postIdsKey, archive, card.workflow.id]);
  useEffect(() => {
    if (open) {
      setMode(keepAvailable ? 'manter' : 'avulso');
      setArchive(false);
    }
  }, [open, keepAvailable]);

  const confirm = async () => {
    const ids = posts.map((p) => p.id);
    const archiveFlag = isTotalSelection && archive;
    setBusy(true);
    try {
      if (keepStepsEnabled && mode === 'manter') {
        const result = await detachPostsKeepingProcess({
          postIds: ids,
          workflowId: card.workflow.id!,
          fingerprint: buildFingerprint(card.workflow, card.allEtapas),
          activeDeadline: deadlines.activeDeadline!,
          requestId,
          stepDeadlines: deadlines.stepDeadlines,
          archiveEmptyFlow: archiveFlag,
        });
        onDetachedKeepingProcess(result, result.archived_workflow_ids.length > 0);
      } else {
        const result = await detachPostsFromWorkflow(ids, archiveFlag);
        onDetachedWithoutProcess(result, archiveFlag);
      }
    } catch (err) {
      toast.error(getPostProcessErrorToast(err, t('detachDialog.error')));
      setRequestId(newRequestId());
    } finally {
      setBusy(false);
    }
  };

  const archiveRow = isTotalSelection && (
    <div className="flex items-center gap-2">
      <Checkbox
        id="detach-archive-empty-flow"
        checked={archive}
        onCheckedChange={(c) => setArchive(c === true)}
        aria-label={t('detachDialog.archive')}
      />
      <Label htmlFor="detach-archive-empty-flow">{t('detachDialog.archive')}</Label>
    </div>
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('detachDialog.title')}</AlertDialogTitle>
          {keepStepsEnabled ? (
            <AlertDialogDescription>
              {t('detachDialog.descKeep', {
                count: posts.length,
                client: card.cliente?.nome || '—',
                stage: card.etapa.nome,
              })}
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription>
              {t('detachDialog.descAvulso', { client: card.cliente?.nome || '—' })}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {keepStepsEnabled && (
          <>
            <ul className="text-sm max-h-32 overflow-y-auto" style={{ color: 'var(--text-muted)' }}>
              {posts.map((p) => (
                <li key={p.id}>{p.titulo || t('shared.postUntitled')}</li>
              ))}
            </ul>
            <div
              role="radiogroup"
              aria-label={t('detachDialog.modeAria')}
              className="flex flex-col gap-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="detach-mode"
                  aria-label={t('detachDialog.keepSteps')}
                  checked={mode === 'manter'}
                  disabled={!keepAvailable}
                  onChange={() => setMode('manter')}
                />
                <span>
                  <Trans
                    t={t}
                    i18nKey="detachDialog.keepStepsDesc"
                    components={{ b: <strong /> }}
                  />
                </span>
              </label>
              {!keepAvailable && (
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: '1.5rem' }}>
                  {availability.reason ?? t('detachDialog.unavailable')}{' '}
                  {t('detachDialog.applyLater')}
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="detach-mode"
                  aria-label={t('detachDialog.avulso')}
                  checked={mode === 'avulso'}
                  onChange={() => setMode('avulso')}
                />
                <span>
                  <Trans t={t} i18nKey="detachDialog.avulsoDesc" components={{ b: <strong /> }} />
                </span>
              </label>
            </div>
          </>
        )}
        {archiveRow}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={busy}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={busy}>
            {busy ? t('detachDialog.detaching') : t('detachDialog.detach')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
