import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { LIMIT_LABELS } from '@/lib/entitlement-errors';
import type { CommitRowResult, UndoResult } from '@/services/dataImport';

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** A failure reason as the user should read it. */
function reasonLabel(reason: string | undefined): string {
  if (reason?.startsWith('plan_limit:')) {
    const key = reason.slice('plan_limit:'.length);
    return `Limite do plano atingido: ${LIMIT_LABELS[key] ?? key}`;
  }
  return 'Erro ao gravar a linha';
}

function downloadFailures(failed: CommitRowResult[]) {
  const csv = [
    'linha_origem;motivo',
    ...failed.map((r) => `"${r.sourceKey.replace(/"/g, '""')}";"${reasonLabel(r.reason)}"`),
  ].join('\n');
  // UTF-8 BOM so Excel opens the accented pt-BR text correctly.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'importacao-falhas.csv';
  link.click();
  URL.revokeObjectURL(url);
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
        <p className="text-sm text-muted">
          As linhas que já entraram não serão duplicadas: ao tentar novamente, continuamos de onde
          paramos.
        </p>
        <Button onClick={onRetry}>Tentar novamente</Button>
      </div>
    );
  }

  if (!results) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Spinner size="sm" /> Importando… {progress.done} de {progress.total}
        </div>
        <Progress value={pct} />
        <p className="text-sm text-muted">Não feche esta aba até terminar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
        <h2 className="text-base font-semibold">Importação concluída</h2>
      </div>

      <Card>
        <CardContent className="grid grid-cols-3 gap-4 pt-6">
          <div>
            <p className="text-2xl font-bold">{summary.created}</p>
            <p className="text-xs uppercase text-muted">Importados</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{summary.skipped}</p>
            <p className="text-xs uppercase text-muted">Já existiam</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{summary.failed.length}</p>
            <p className="text-xs uppercase text-muted">Falharam</p>
          </div>
        </CardContent>
      </Card>

      {summary.failed.length > 0 && (
        <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
          <ul className="space-y-1">
            {summary.byReason.map(([label, count]) => (
              <li key={label}>
                {label} — {plural(count, 'linha não importada', 'linhas não importadas')}.
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => downloadFailures(summary.failed)}>
            <Download aria-hidden /> Baixar relatório de falhas (CSV)
          </Button>
        </div>
      )}

      {undoResult ? (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="font-semibold">
            {plural(undoResult.deleted, 'registro removido', 'registros removidos')}.
          </p>
          {undoResult.skippedPublished.length > 0 && (
            <p>
              {plural(undoResult.skippedPublished.length, 'post mantido', 'posts mantidos')}: já
              foram publicados no Instagram ou no TikTok.
            </p>
          )}
          {undoResult.skippedWorkflows.length > 0 && (
            <p>
              {plural(
                undoResult.skippedWorkflows.length,
                'calendário mantido',
                'calendários mantidos',
              )}
              : ainda têm posts ou links criados depois da importação.
            </p>
          )}
          {undoResult.skippedTemplates.length > 0 && (
            <p>
              {plural(
                undoResult.skippedTemplates.length,
                'modelo de fluxo mantido',
                'modelos de fluxo mantidos',
              )}
              : ainda estão em uso por entregas ou campos personalizados.
            </p>
          )}
          {undoResult.skippedClientes.length > 0 && (
            <p>
              {plural(undoResult.skippedClientes.length, 'cliente mantido', 'clientes mantidos')}:
              já têm dados criados fora desta importação (fluxos, ideias, contas conectadas).
            </p>
          )}
          <p className="text-muted">
            Clientes mesclados com registros que já existiam nunca são apagados.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="text-muted">
            Você tem 7 dias para desfazer esta importação. Nós mantemos o que passou a depender de
            outras coisas — posts já publicados, calendários com conteúdo novo e clientes com dados
            criados depois — e listamos tudo o que ficou.
          </p>
          {confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={undoing} onClick={onUndo}>
                {undoing ? <Spinner size="sm" /> : <Undo2 aria-hidden />} Confirmar e desfazer
              </Button>
              <Button variant="secondary" disabled={undoing} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              <Undo2 aria-hidden /> Desfazer importação
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
