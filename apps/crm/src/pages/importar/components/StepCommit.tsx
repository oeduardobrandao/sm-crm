import { downloadCsv } from '@/lib/csvExport';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { LIMIT_LABELS } from '@/lib/entitlement-errors';
import type { CommitRowResult, UndoResult } from '@/services/dataImport';

/** A failure reason as the user should read it. Resolved at call time (follows the UI language). */
export function reasonLabel(reason: string | undefined): string {
  if (reason?.startsWith('plan_limit:')) {
    const key = reason.slice('plan_limit:'.length);
    const limit = i18n.exists(`importWizard:limits.${key}`)
      ? i18n.t(`importWizard:limits.${key}`)
      : (LIMIT_LABELS[key] ?? key);
    return i18n.t('importWizard:commit.reasonPlanLimit', { limit });
  }
  return i18n.t('importWizard:commit.reasonRowError');
}

/**
 * Neutralizes CSV formula injection. `sourceKey` derives from the uploaded
 * filename — a file named e.g. `=cmd|'/c calc'!A0.csv` would otherwise put a
 * cell starting with `=` into the downloaded report, which spreadsheet
 * software with legacy formula execution enabled may run on open. Prefixing
 * a leading `=`, `+`, `-`, or `@` with a single quote forces the cell to be
 * read as literal text (the same convention Excel/Sheets use themselves),
 * without changing how the value displays. Applied to every field written to
 * this CSV, not just sourceKey, since any of them could carry attacker-chosen
 * text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadFailures(failed: CommitRowResult[]) {
  const csv = [
    i18n.t('importWizard:commit.csvHeader'),
    ...failed.map((r) => `${csvCell(r.sourceKey)};${csvCell(reasonLabel(r.reason))}`),
  ].join('\n');
  // UTF-8 BOM so Excel opens the accented text correctly.
  void downloadCsv(`\uFEFF${csv}`, i18n.t('importWizard:commit.csvFile'));
}

export default function StepCommit({
  progress,
  results,
  error,
  undoResult,
  undoing,
  onRetry,
  onUndo,
}: {
  progress: { done: number; total: number };
  results: CommitRowResult[] | null;
  error: string | null;
  undoResult: UndoResult | null;
  undoing: boolean;
  onRetry: () => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation('importWizard');
  const [confirming, setConfirming] = useState(false);

  const summary = useMemo(() => {
    const rows = results ?? [];
    const failed = rows.filter((r) => r.failed);
    const byReason = new Map<string, number>();
    for (const row of failed) {
      const label = reasonLabel(row.reason);
      byReason.set(label, (byReason.get(label) ?? 0) + 1);
    }
    return {
      created: rows.filter((r) => !r.failed && !r.skipped).length,
      skipped: rows.filter((r) => r.skipped).length,
      failed,
      byReason: [...byReason.entries()],
    };
  }, [results]);

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('commit.resumeNote')}</p>
        <Button onClick={onRetry}>{t('commit.retryAgain')}</Button>
      </div>
    );
  }

  if (!results) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Spinner size="sm" />{' '}
          {t('commit.importing', { done: progress.done, total: progress.total })}
        </div>
        <Progress value={pct} />
        <p className="text-sm text-muted-foreground">{t('commit.dontClose')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
        <h2 className="text-base font-semibold">{t('commit.done')}</h2>
      </div>

      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6">
          <div>
            <p className="text-2xl font-bold">{summary.created}</p>
            <p className="text-xs uppercase text-muted-foreground">{t('commit.created')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{summary.skipped}</p>
            <p className="text-xs uppercase text-muted-foreground">{t('commit.skipped')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{summary.failed.length}</p>
            <p className="text-xs uppercase text-muted-foreground">{t('commit.failed')}</p>
          </div>
        </CardContent>
      </Card>

      {summary.failed.length > 0 && (
        <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
          <ul className="space-y-1">
            {summary.byReason.map(([label, count]) => (
              <li key={label}>
                {t('commit.reasonLine', { label, counted: t('count.rowNotImported', { count }) })}
              </li>
            ))}
          </ul>
          {/*
            Per-row failures land here, not in the `error` branch above — so
            without this button the only exit was restarting the wizard, which
            opens a NEW job. Nothing from this job is recorded against that new
            id, so every row that already succeeded would be inserted a second
            time. Retrying HERE reuses the current job, where import_commit_row
            is idempotent per (job_id, source_row_key): the rows that landed are
            skipped and only the failed ones do real work.
          */}
          <p className="text-muted-foreground">{t('commit.retryNote')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRetry}>
              <RefreshCw aria-hidden /> {t('commit.retryFailed')}
            </Button>
            <Button variant="secondary" onClick={() => downloadFailures(summary.failed)}>
              <Download aria-hidden /> {t('commit.downloadFailures')}
            </Button>
          </div>
        </div>
      )}

      {undoResult ? (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="font-semibold">
            {t('count.recordRemoved', { count: undoResult.deleted })}.
          </p>
          {undoResult.skippedPublished.length > 0 && (
            <p>
              {t('commit.publishedKept', {
                counted: t('count.postKept', { count: undoResult.skippedPublished.length }),
              })}
            </p>
          )}
          {undoResult.skippedWorkflows.length > 0 && (
            <p>
              {t('commit.workflowsKept', {
                counted: t('count.calendarKept', { count: undoResult.skippedWorkflows.length }),
              })}
            </p>
          )}
          {undoResult.skippedTemplates.length > 0 && (
            <p>
              {t('commit.templatesKept', {
                counted: t('count.templateKept', { count: undoResult.skippedTemplates.length }),
              })}
            </p>
          )}
          {undoResult.skippedClientes.length > 0 && (
            <p>
              {t('commit.clientsKept', {
                counted: t('count.clientKept', { count: undoResult.skippedClientes.length }),
              })}
            </p>
          )}
          <p className="text-muted-foreground">{t('commit.mergedNeverDeleted')}</p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="text-muted-foreground">{t('commit.undoNote')}</p>
          {confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={undoing} onClick={onUndo}>
                {undoing ? <Spinner size="sm" /> : <Undo2 aria-hidden />} {t('commit.confirmUndo')}
              </Button>
              <Button variant="secondary" disabled={undoing} onClick={() => setConfirming(false)}>
                {t('commit.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              <Undo2 aria-hidden /> {t('commit.undo')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
