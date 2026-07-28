import { AlertTriangle } from 'lucide-react';
import type { ImportBundle } from '@mesaas/import-parsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { SourceGuide } from '../sourceGuides';
import { MAX_FILES, MAX_ROWS, totalRows } from '../parseFiles';

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
  error: string | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const rows = bundle ? totalRows(bundle) : 0;
  const collections = bundle?.collections.length ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <label htmlFor="import-files" className="block text-sm font-semibold">
            Arquivos de exportação
          </label>
          <input
            id="import-files"
            type="file"
            multiple
            accept={guide.accept}
            aria-label="Arquivos de exportação"
            className="block w-full text-sm"
            onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
          />
          <p className="text-xs text-muted">
            Até {MAX_FILES} arquivos, 20 MB cada e {MAX_ROWS.toLocaleString('pt-BR')} linhas por
            importação. Os arquivos são lidos no seu navegador — nenhum arquivo é enviado para
            nossos servidores.
          </p>
        </CardContent>
      </Card>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" /> Lendo os arquivos…
        </div>
      )}

      {error && (
        <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      {bundle && !error && (
        <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="font-semibold">
            {collections} {collections === 1 ? 'coleção' : 'coleções'} · {rows}{' '}
            {rows === 1 ? 'linha' : 'linhas'}
          </p>
          <ul className="text-muted">
            {bundle.collections.map((c) => (
              <li key={c.id}>
                {c.name} — {c.rows.length} {c.rows.length === 1 ? 'linha' : 'linhas'}
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
          Voltar
        </Button>
        <Button disabled={!bundle || busy} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
