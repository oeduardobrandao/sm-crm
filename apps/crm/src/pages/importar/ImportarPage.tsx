import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  proposeMapping,
  type ImportBundle,
  type MappingProposal,
  type SourceKind,
} from '@mesaas/import-parsers';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { getClientes } from '@/store';
import {
  analyzeImport,
  commitBatch,
  friendlyImportError,
  previewImport,
  startImport,
  undoImport,
  type CommitRow,
  type CommitRowResult,
  type PreviewResult,
  type UndoResult,
} from '@/services/dataImport';
import { buildCommitRows, type ExistingCliente } from './buildCommitRows';
import { mergeAiProposal, summarizeBundle } from './mapping';
import { ParseFilesError, parseFiles } from './parseFiles';
import { sourceGuide } from './sourceGuides';
import StepOrigem from './components/StepOrigem';
import StepUpload from './components/StepUpload';
import StepMapeamento from './components/StepMapeamento';
import StepPrevia from './components/StepPrevia';
import StepCommit from './components/StepCommit';

/** Server cap per commit request (handler.ts BATCH_LIMIT). */
const BATCH_SIZE = 200;

type Step = 'origem' | 'upload' | 'mapeamento' | 'previa' | 'commit';

const STEP_TITLES: [Step, string][] = [
  ['origem', 'Origem'],
  ['upload', 'Arquivos'],
  ['mapeamento', 'Mapeamento'],
  ['previa', 'Prévia'],
  ['commit', 'Importar'],
];

export default function ImportarPage() {
  const [step, setStep] = useState<Step>('origem');
  const [source, setSource] = useState<SourceKind | null>(null);
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [proposal, setProposal] = useState<MappingProposal | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitRows, setCommitRows] = useState<CommitRow[]>([]);
  const [ignoredRows, setIgnoredRows] = useState(0);

  const [jobId, setJobId] = useState<number | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<CommitRowResult[] | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [undoResult, setUndoResult] = useState<UndoResult | null>(null);
  const [undoing, setUndoing] = useState(false);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const existingClientes: ExistingCliente[] = clientes
    .filter((c): c is typeof c & { id: number } => typeof c.id === 'number')
    .map((c) => ({ id: c.id, nome: c.nome }));

  // --- step 2: parse ---------------------------------------------------------
  async function handleFiles(files: File[]) {
    if (!source || files.length === 0) return;
    setUploadError(null);
    setBundle(null);
    setBusy(true);
    try {
      setBundle(await parseFiles(source, files));
    } catch (err) {
      setUploadError(
        err instanceof ParseFilesError
          ? err.message
          : 'Não conseguimos ler este arquivo — confira o passo a passo de exportação acima.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** Heuristic mapping first; the AI refinement is best-effort on top of it. */
  async function goToMapping() {
    if (!bundle) return;
    const heuristic = proposeMapping(bundle);
    setProposal(heuristic);
    setMappingError(null);
    setStep('mapeamento');
    setBusy(true);
    try {
      const { proposal: refined } = await analyzeImport(summarizeBundle(bundle), heuristic);
      // The user may have edited the form while the request was in flight —
      // merge onto the CURRENT proposal, never onto the stale snapshot.
      if (refined) setProposal((current) => mergeAiProposal(current ?? heuristic, refined));
    } catch {
      // AI mapping is an enhancement, never a dependency: the heuristic form is
      // already on screen and fully editable.
    } finally {
      setBusy(false);
    }
  }

  // --- step 4: preview -------------------------------------------------------
  async function goToPreview() {
    if (!bundle || !proposal) return;
    const unassigned = proposal.collections.filter(
      (m) =>
        m.destination !== 'ignorar' &&
        m.destination !== 'clientes' &&
        m.clientAssignment.mode === 'fixed' &&
        !m.clientAssignment.clienteNome.trim(),
    );
    if (unassigned.length > 0) {
      const names = unassigned
        .map((m) => bundle.collections.find((c) => c.id === m.collectionId)?.name ?? m.collectionId)
        .join(', ');
      setMappingError(`Escolha o cliente de: ${names}.`);
      return;
    }
    setMappingError(null);
    setPreviewError(null);
    setPreview(null);
    setStep('previa');
    setBusy(true);
    try {
      // Chunking OFF here on purpose: preview counts a client's posts under one
      // container so the server can warn about the per-calendar cap. The rows
      // that actually get committed are rebuilt below with the cap it returns.
      const unchunked = buildCommitRows(bundle, proposal, existingClientes, null);
      const result = await previewImport(unchunked);
      setPreview(result);
      const rows = buildCommitRows(
        bundle,
        proposal,
        existingClientes,
        result.limits.maxPostsPerWorkflow,
      );
      setCommitRows(rows);
      // How many source rows produced nothing (no client resolvable, no name).
      // Containers, templates and auto-created clientes are synthesized rather
      // than read from a source row, so none of them may count here — otherwise
      // they mask the very rows this number exists to surface.
      const sourceRowCount = bundle.collections
        .filter(
          (c) =>
            proposal.collections.find((m) => m.collectionId === c.id)?.destination !== 'ignorar',
        )
        .reduce((n, c) => n + c.rows.length, 0);
      const fromSource = rows.filter(
        (r) =>
          r.kind !== 'container' &&
          r.kind !== 'template' &&
          !r.sourceKey.startsWith('auto-cliente:'),
      ).length;
      setIgnoredRows(Math.max(0, sourceRowCount - fromSource));
    } catch (err) {
      setPreviewError(friendlyImportError(err));
    } finally {
      setBusy(false);
    }
  }

  // --- step 5: commit --------------------------------------------------------
  async function runCommit(rows: CommitRow[], existingJobId: number | null) {
    setCommitError(null);
    setResults(null);
    setProgress({ done: 0, total: rows.length });
    try {
      let id = existingJobId;
      if (id == null) {
        // A retry reuses the job: import_commit_row is idempotent per source row,
        // so re-sending from batch 0 skips what already landed.
        id = (await startImport(source ?? 'csv', rows.length)).jobId;
        setJobId(id);
      }
      const acc: CommitRowResult[] = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const isLast = i + BATCH_SIZE >= rows.length;
        const result = await commitBatch(id, batch, isLast);
        acc.push(...result.results);
        setProgress({ done: Math.min(i + batch.length, rows.length), total: rows.length });
      }
      setResults(acc);
      const failed = acc.filter((r) => r.failed).length;
      if (failed === 0) toast.success('Importação concluída.');
    } catch (err) {
      setCommitError(friendlyImportError(err));
    }
  }

  function startCommit() {
    setStep('commit');
    void runCommit(commitRows, jobId);
  }

  async function handleUndo() {
    if (jobId == null) return;
    setUndoing(true);
    try {
      setUndoResult(await undoImport(jobId));
    } catch (err) {
      toast.error(friendlyImportError(err));
    } finally {
      setUndoing(false);
    }
  }

  const guide = sourceGuide(source ?? 'csv');
  const currentIndex = STEP_TITLES.findIndex(([s]) => s === step);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Importar dados</h1>
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase text-muted">
          {STEP_TITLES.map(([id, label], i) => (
            <li key={id} className={i === currentIndex ? 'font-bold text-primary' : undefined}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      <FeatureGate flag="feature_csv_import" label="A importação de dados">
        {step === 'origem' && (
          <StepOrigem source={source} onSelect={setSource} onNext={() => setStep('upload')} />
        )}

        {step === 'upload' && (
          <StepUpload
            guide={guide}
            bundle={bundle}
            error={uploadError}
            busy={busy}
            onFiles={(files) => void handleFiles(files)}
            onBack={() => setStep('origem')}
            onNext={() => void goToMapping()}
          />
        )}

        {step === 'mapeamento' && bundle && proposal && (
          <StepMapeamento
            bundle={bundle}
            proposal={proposal}
            clientes={existingClientes}
            error={mappingError}
            onChange={setProposal}
            onBack={() => setStep('upload')}
            onNext={() => void goToPreview()}
          />
        )}

        {step === 'previa' && (
          <StepPrevia
            preview={preview}
            rowCount={commitRows.length}
            ignoredRows={ignoredRows}
            busy={busy}
            error={previewError}
            onBack={() => setStep('mapeamento')}
            onImport={startCommit}
          />
        )}

        {step === 'commit' && (
          <StepCommit
            progress={progress}
            results={results}
            error={commitError}
            undoResult={undoResult}
            undoing={undoing}
            onRetry={() => void runCommit(commitRows, jobId)}
            onUndo={() => void handleUndo()}
          />
        )}
      </FeatureGate>
    </div>
  );
}
