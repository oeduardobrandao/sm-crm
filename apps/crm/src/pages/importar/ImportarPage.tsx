import { useState } from 'react';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
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
import { ParseFilesError, UNREADABLE_MESSAGE, parseFiles } from './parseFiles';
import { sourceGuide } from './sourceGuides';
import StepOrigem from './components/StepOrigem';
import StepUpload, { type UploadError } from './components/StepUpload';
import StepMapeamento from './components/StepMapeamento';
import StepPrevia from './components/StepPrevia';
import StepCommit from './components/StepCommit';

/** Server cap per commit request (handler.ts BATCH_LIMIT). */
const BATCH_SIZE = 200;

/**
 * Query keys that read data an import (or its undo) can create/delete rows in.
 * The global `staleTime` (30s, App.tsx's QueryClient) means any of these caches
 * can still be "fresh" right after a commit, so without an explicit
 * invalidation here the pages below would render the pre-import snapshot until
 * the cache naturally expires.
 *
 * Scoped to what `buildCommitRows` actually emits — not a blanket
 * `invalidateQueries()` with no key, which would refetch every query in the
 * app on every commit/undo:
 *   - cliente        -> clientes table          -> ['clientes']            (ClientesPage, ClienteDetalhePage, dashboard, financeiro, contratos, ideias, entregas, analytics-fluxos, ...)
 *   - container       -> workflows table         -> ['workflows']           (CalendarioPage, DashboardPage, useEntregasData, AnalyticsFluxosPage, ConcludedView)
 *   - entrega         -> workflows table         -> ['workflows']           (same table as containers -- see data-import migration 20260728000001, `when 'entrega' then 'workflows'`)
 *   - template        -> workflow_templates table -> ['workflow-templates'] (useEntregasData, AnalyticsFluxosPage)
 *   - post            -> workflow_posts table    -> ['scheduled-posts']    (Entregas Calendar "publicações" mode reads posts workspace-wide by date range; per-workflow/per-client keys like workflow-posts-with-props or clientePosts are parameterized by an id that did not exist before the import, so there is no stale cache entry for them to begin with)
 *   - ideia           -> ideias table            -> ['hub-ideias-all']     (IdeiasPage's global list)
 *
 * Per-workflow/per-client aggregate counts (workflow-posts-counts and its
 * siblings) are DERIVED from the `['workflows']` query inside useEntregasData
 * (keyed on the active workflow ids) -- invalidating `['workflows']` changes
 * that derived key once it refetches, which is what makes those counts fresh
 * again without needing their own explicit invalidation here.
 */
const IMPORT_AFFECTED_QUERY_KEYS: QueryKey[] = [
  ['clientes'],
  ['workflows'],
  ['workflow-templates'],
  ['hub-ideias-all'],
  ['scheduled-posts'],
];

function invalidateImportedData(queryClient: QueryClient) {
  for (const queryKey of IMPORT_AFFECTED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

type Step = 'origem' | 'upload' | 'mapeamento' | 'previa' | 'commit';

const STEP_TITLES: [Step, string][] = [
  ['origem', 'Origem'],
  ['upload', 'Arquivos'],
  ['mapeamento', 'Mapeamento'],
  ['previa', 'Prévia'],
  ['commit', 'Importar'],
];

export default function ImportarPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('origem');
  const [source, setSource] = useState<SourceKind | null>(null);
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [proposal, setProposal] = useState<MappingProposal | null>(null);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
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

  const {
    data: clientes = [],
    isPending: clientesPending,
    isError: clientesIsError,
    refetch: refetchClientes,
  } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const existingClientes: ExistingCliente[] = clientes
    .filter((c): c is typeof c & { id: number } => typeof c.id === 'number')
    .map((c) => ({ id: c.id, nome: c.nome }));
  // A client name referenced by the import resolves to "existing" only via
  // existingClientes: an unresolved or failed load silently reads as "no
  // existing clients", turning every merge into a brand-new duplicate.
  // Advancing past mapping is blocked (Continuar disabled) until this is 'ready'.
  const clientesStatus: 'pending' | 'error' | 'ready' = clientesPending
    ? 'pending'
    : clientesIsError
      ? 'error'
      : 'ready';

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
          ? { message: err.message, details: err.details }
          : { message: UNREADABLE_MESSAGE, details: [] },
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
    // Defence in depth: the "Continuar" button is already disabled while this
    // is true, but a client resolution bug here can turn a whole existing
    // client into a duplicate, so this never proceeds on an unresolved guess.
    if (clientesStatus !== 'ready') return;
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
    // NOTHING TO COMMIT. `startImport` opens a job in status 'committing' and
    // only a batch sent with `final: true` closes it — so creating a job for an
    // empty row set would strand it there, with the UI stuck on its spinner.
    // The prévia's "Importar" button is already disabled at rowCount === 0
    // (rowCount IS commitRows.length, so it can only be 0 when this array is),
    // making this defence in depth rather than a reachable path — but the cost
    // of the guard is one comparison and the cost of the hole is a permanently
    // stuck job, so it stays.
    if (rows.length === 0 && existingJobId == null) {
      setCommitError(
        'Nenhum registro para importar — volte e ajuste o mapeamento antes de tentar de novo.',
      );
      return;
    }
    try {
      let id = existingJobId;
      if (id == null) {
        // A retry reuses the job: import_commit_row is idempotent per source row,
        // so re-sending from batch 0 skips what already landed.
        id = (await startImport(source ?? 'csv', rows.length)).jobId;
        setJobId(id);
      }
      // Materialized rather than looped over `rows` directly so that an ALREADY
      // OPEN job with nothing left to send still gets one closing `final: true`
      // batch instead of being abandoned in 'committing'.
      const batches: CommitRow[][] = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));
      if (batches.length === 0) batches.push([]);

      const acc: CommitRowResult[] = [];
      let done = 0;
      for (const [index, batch] of batches.entries()) {
        const result = await commitBatch(id, batch, index === batches.length - 1);
        acc.push(...result.results);
        done += batch.length;
        setProgress({ done, total: rows.length });
      }
      setResults(acc);
      const failed = acc.filter((r) => r.failed).length;
      if (failed === 0) toast.success('Importação concluída.');
      // A retried/idempotent batch can come back with every row `skipped`
      // (already committed by an earlier attempt) or `failed` (plan-limit
      // refusal) — neither actually changed the database, so invalidating
      // caches on THAT run would just be a wasted refetch. Only a row that
      // landed this call (`skipped: false, failed: false`) means something new
      // is now in a table one of IMPORT_AFFECTED_QUERY_KEYS reads.
      if (acc.some((r) => !r.skipped && !r.failed)) invalidateImportedData(queryClient);
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
      const result = await undoImport(jobId);
      setUndoResult(result);
      // `deleted` is the count of rows undo actually removed; a job with
      // nothing committed (or one where every row was already undone) leaves
      // every cache above genuinely unchanged.
      if (result.deleted > 0) invalidateImportedData(queryClient);
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
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase text-muted-foreground">
          {STEP_TITLES.map(([id, label], i) => (
            <li
              key={id}
              // Colour alone carried "which step am I on"; aria-current states it
              // for screen readers and for anyone who cannot separate the yellow
              // from the grey.
              aria-current={i === currentIndex ? 'step' : undefined}
              className={i === currentIndex ? 'font-bold text-primary' : undefined}
            >
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
            clientesStatus={clientesStatus}
            onRetryClientes={() => void refetchClientes()}
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
