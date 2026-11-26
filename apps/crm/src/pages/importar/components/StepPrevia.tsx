import { AlertTriangle, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { PreviewResult } from '@/services/dataImport';

const COUNT_KEYS = ['clientes', 'posts', 'entregas', 'ideias'] as const;

export default function StepPrevia({
  preview,
  rowCount,
  ignoredRows,
  busy,
  error,
  onBack,
  onImport,
}: {
  preview: PreviewResult | null;
  rowCount: number;
  ignoredRows: number;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation('importWizard');
  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold">{t('preview.title')}</h2>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> {t('preview.checking')}
        </div>
      )}

      {error && (
        <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      {preview && (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
              {COUNT_KEYS.map((key) => (
                <div key={key}>
                  <p className="text-2xl font-bold">{preview.counts[key] ?? 0}</p>
                  <p className="text-xs uppercase text-muted-foreground">
                    {t(`destination.${key}`)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {preview.warnings.length > 0 && (
            <ul className="space-y-2">
              {preview.warnings.map((w) => (
                <li
                  key={w}
                  className="flex gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          {ignoredRows > 0 && (
            <p className="flex gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t('preview.ignoredRows', {
                counted: t('count.rowIgnored', { count: ignoredRows }),
              })}
            </p>
          )}

          <p className="text-xs text-muted-foreground">{t('preview.mergeNote')}</p>
        </>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button disabled={!preview || busy || rowCount === 0} onClick={onImport}>
          {t('nav.importCount', { count: rowCount })}
        </Button>
      </div>
    </div>
  );
}
