import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import type { ImportBundle } from '@mesaas/import-parsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { SourceGuide } from '../sourceGuides';
import { MAX_FILES, MAX_ROWS, totalRows } from '../parseFiles';
import SourceGuideCard from './SourceGuideCard';

export interface UploadError {
  message: string;
  details: string[];
}

export default function StepUpload({
  guide,
  bundle,
  error,
  busy,
  onFiles,
  onBack,
  onNext,
}: {
  guide: SourceGuide;
  bundle: ImportBundle | null;
  error: UploadError | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation('importWizard');
  const intlLocale = useIntlLocale();
  const rows = bundle ? totalRows(bundle) : 0;
  const collections = bundle?.collections.length ?? 0;

  return (
    <div className="space-y-6">
      <SourceGuideCard guide={guide} collapsible />

      <Card>
        <CardContent className="space-y-3 pt-6">
          <label htmlFor="import-files" className="block text-sm font-semibold">
            {t('upload.filesLabel')}
          </label>
          {/* file inputs cannot be styled directly — the browser paints the
              "Choose Files" control itself. ::file-selector-button is the one
              hook that reaches it, so the trigger is styled to match <Button
              variant="secondary"> instead of being left as the raw grey OS
              widget. */}
          <input
            id="import-files"
            type="file"
            multiple
            accept={guide.accept}
            aria-label={t('upload.filesLabel')}
            className="block w-full cursor-pointer text-sm text-muted-foreground
              file:mr-3 file:cursor-pointer file:rounded-md file:border-0
              file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium
              file:text-secondary-foreground file:transition hover:file:bg-secondary/80"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so picking the SAME file again (retrying after a parse
              // error) still fires onChange — otherwise the browser sees no
              // value change and the user is stuck needing a different file.
              e.target.value = '';
              onFiles(files);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('upload.limits', { files: MAX_FILES, rows: MAX_ROWS.toLocaleString(intlLocale) })}
          </p>
        </CardContent>
      </Card>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> {t('upload.reading')}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error.message}</p>
          </div>
          {error.details.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-9 text-xs">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {bundle && !error && (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="font-semibold">
            {t('count.collection', { count: collections })} · {t('count.row', { count: rows })}
          </p>
          <ul className="text-muted-foreground">
            {bundle.collections.map((c) => (
              <li key={c.id}>
                {t('upload.collectionLine', {
                  name: c.name,
                  rows: t('count.row', { count: c.rows.length }),
                })}
              </li>
            ))}
          </ul>
          {bundle.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-warning">
              {bundle.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button disabled={!bundle || busy} onClick={onNext}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
