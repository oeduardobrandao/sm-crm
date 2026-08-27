import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportCollection } from '@mesaas/import-parsers';
import type { CommitRow } from '@/services/dataImport';

// --- mocks ------------------------------------------------------------------

const { parseGenericCsv } = vi.hoisted(() => ({ parseGenericCsv: vi.fn() }));

vi.mock('@mesaas/import-parsers', async (importOriginal) => {
  // Only the file parsers are stubbed: proposeMapping/toTipTapDoc are the real
  // ones, so this test drives the same mapping the browser would produce.
  const actual = await importOriginal<typeof import('@mesaas/import-parsers')>();
  return { ...actual, parseGenericCsv };
});

vi.mock('@/services/dataImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/dataImport')>();
  return {
    ...actual,
    startImport: vi.fn(),
    analyzeImport: vi.fn(),
    previewImport: vi.fn(),
    commitBatch: vi.fn(),
    undoImport: vi.fn(),
  };
});

vi.mock('@/store', () => ({ getClientes: vi.fn() }));

// The wizard sits behind FeatureGate(feature_csv_import); the real gate runs, only
// its entitlement source is stubbed.
const { entitlements } = vi.hoisted(() => ({ entitlements: { csvImport: true } }));
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    hasFeature: (flag: string) => flag !== 'feature_csv_import' || entitlements.csvImport,
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const SelectContext = ReactModule.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }
  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value ?? placeholder ?? ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import ImportarPage from '../ImportarPage';
import { getClientes } from '@/store';
import {
  analyzeImport,
  commitBatch,
  previewImport,
  startImport,
  undoImport,
} from '@/services/dataImport';

const mockedStart = vi.mocked(startImport);
const mockedAnalyze = vi.mocked(analyzeImport);
const mockedPreview = vi.mocked(previewImport);
const mockedCommit = vi.mocked(commitBatch);
const mockedUndo = vi.mocked(undoImport);

// --- fixtures ---------------------------------------------------------------

const POST_COUNT = 250;

function calendarCollection(): ImportCollection {
  return {
    id: 'calendario.csv',
    name: 'calendario',
    source: 'csv',
    columns: ['Nome', 'Cliente', 'Data'],
    listNames: [],
    rows: Array.from({ length: POST_COUNT }, (_, i) => ({
      key: `r${i + 1}`,
      cells: { Nome: `Post ${i + 1}`, Cliente: 'Ana', Data: '' },
    })),
  };
}

function renderPage(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ImportarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const okResults = (rows: CommitRow[]) =>
  rows.map((r) => ({ sourceKey: r.sourceKey, table: 'x', rowId: '1', skipped: false }));

/** Drives origem -> upload -> mapeamento (stops before the prévia click). */
async function advanceToMapping(queryClient?: QueryClient) {
  renderPage(queryClient);
  fireEvent.click(await screen.findByRole('button', { name: 'Planilha (CSV)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  const input = screen.getByLabelText('Arquivos de exportação');
  fireEvent.change(input, { target: { files: [new File(['a,b'], 'calendario.csv')] } });
  await screen.findByText(`1 coleção · ${POST_COUNT} linhas`);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  await screen.findByText('calendario');
}

/**
 * Drives origem -> upload -> mapeamento -> prévia.
 *
 * Settles on the Importar button being ENABLED, not on the heading. StepPrevia renders
 * "Prévia da importação" the moment the step switches, while the preview request is still
 * in flight and the button is still `disabled={!preview || busy || rowCount === 0}`. A
 * fireEvent.click on a disabled button is a silent no-op, so a caller that clicked in that
 * window lost its click and then sat on the findBy ceiling waiting for a commit that never
 * started. That is what made this file flake on CI.
 */
async function advanceToPreview(queryClient?: QueryClient) {
  await advanceToMapping(queryClient);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByText('Prévia da importação');
  await waitFor(() => expect(screen.getByRole('button', { name: /Importar/ })).toBeEnabled());
}

beforeEach(() => {
  entitlements.csvImport = true;
  vi.mocked(getClientes).mockResolvedValue([
    {
      id: 3,
      nome: 'Ana',
      sigla: 'AN',
      cor: '#000',
      plano: '',
      email: '',
      telefone: '',
      status: 'ativo',
      valor_mensal: 0,
    },
  ]);
  parseGenericCsv.mockReturnValue(calendarCollection());
  mockedAnalyze.mockResolvedValue({ proposal: null });
  mockedPreview.mockResolvedValue({
    counts: { clientes: 0, posts: POST_COUNT, entregas: 0, ideias: 0 },
    warnings: ['Um calendário do import tem 250 posts, acima do limite do seu plano.'],
    limits: {
      maxClients: null,
      maxWorkflowTemplates: null,
      maxPostsPerWorkflow: 100,
      maxActiveWorkflowsPerClient: null,
    },
  });
  mockedStart.mockResolvedValue({ jobId: 42 });
  mockedCommit.mockImplementation(async (_job, rows) => ({ results: okResults(rows) }));
});

// --- tests ------------------------------------------------------------------

describe('ImportarPage', () => {
  // Regression for the CI flake that reddened four unrelated branches between
  // 2026-07-31 and 2026-08-03. StepPrevia renders its "Prévia da importação"
  // heading as soon as the step switches, but the Importar button stays disabled
  // until the preview request lands (`disabled={!preview || busy || rowCount === 0}`).
  // Waiting on the heading therefore does NOT mean the button is clickable, and a
  // fireEvent.click on a disabled button is a silent no-op — the commit simply never
  // ran and the test sat on the findBy ceiling until it gave up. Locally the mocked
  // preview resolved inside the same flush, hiding it; a loaded CI runner did not.
  // Deferring the preview by a macrotask reproduces that window deterministically.
  test('does not drop the Importar click while the prévia is still loading', async () => {
    mockedPreview.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                counts: { clientes: 0, posts: POST_COUNT, entregas: 0, ideias: 0 },
                warnings: [],
                limits: {
                  maxClients: null,
                  maxWorkflowTemplates: null,
                  maxPostsPerWorkflow: 100,
                  maxActiveWorkflowsPerClient: null,
                },
              }),
            // Must outlast findByText('Prévia da importação'), which resolves almost
            // immediately because the heading is already in the DOM. That gap IS the bug.
            50,
          ),
        ),
    );

    await advanceToPreview();

    // The precondition advanceToPreview owes every caller that clicks Importar.
    expect(screen.getByRole('button', { name: /Importar/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');
    expect(mockedCommit).toHaveBeenCalled();
  });

  test('walks origem -> upload -> mapeamento -> prévia, previewing unchunked rows', async () => {
    await advanceToPreview();

    expect(screen.getByText('Posts')).toBeInTheDocument();
    expect(screen.getByText(String(POST_COUNT))).toBeInTheDocument();
    expect(
      screen.getByText('Um calendário do import tem 250 posts, acima do limite do seu plano.'),
    ).toBeInTheDocument();

    // Preview runs with chunking OFF so its per-container counts stay honest.
    const previewed = mockedPreview.mock.calls[0][0];
    expect(previewed.filter((r) => r.kind === 'container')).toHaveLength(1);
    expect(previewed.filter((r) => r.kind === 'post')).toHaveLength(POST_COUNT);
  });

  // Heaviest test in the file (full wizard walk + 253-row two-slice commit). It once
  // carried a 15s findByText timeout, on the theory that CI load made the completion
  // screen slow. That diagnosis was wrong: the click was landing on a still-disabled
  // Importar button and never starting a commit at all, so no ceiling could have saved
  // it. advanceToPreview now waits for the button, and the default timeout is back.
  test('commits in slices of 200, chunked by the plan cap the preview returned', async () => {
    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));

    await screen.findByText('Importação concluída');

    // 250 posts at a cap of 100 -> 3 containers -> 253 rows -> 200 + 53.
    expect(mockedStart).toHaveBeenCalledWith('csv', 253);
    expect(mockedCommit).toHaveBeenCalledTimes(2);
    const [firstJob, firstRows, firstFinal] = mockedCommit.mock.calls[0];
    const [secondJob, secondRows, secondFinal] = mockedCommit.mock.calls[1];
    expect(firstJob).toBe(42);
    expect(secondJob).toBe(42);
    expect(firstRows).toHaveLength(200);
    expect(secondRows).toHaveLength(53);
    expect(firstFinal).toBe(false);
    expect(secondFinal).toBe(true);
    const committed = [...firstRows, ...secondRows];
    expect(committed.filter((r) => r.kind === 'container')).toHaveLength(3);
    expect(committed.filter((r) => r.kind === 'post')).toHaveLength(POST_COUNT);
  }, 30_000);

  // The global QueryClient staleTime (30s, App.tsx) means ['clientes'] and the
  // other pages this wizard can affect stay "fresh" — i.e. NOT refetched —
  // right after a commit unless something explicitly invalidates them. Without
  // that invalidation, navigating straight to /clientes (or Entregas, or
  // Ideias) after an import renders the pre-import snapshot.
  const IMPORT_AFFECTED_KEYS = [
    ['clientes'],
    ['workflows'],
    ['workflow-templates'],
    ['hub-ideias-all'],
    ['scheduled-posts'],
  ];

  test('invalidates the CRM caches an import can affect after a commit that creates rows', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await advanceToPreview(qc);
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    for (const queryKey of IMPORT_AFFECTED_KEYS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  test('does not invalidate anything when a commit run creates no rows', async () => {
    // Every row comes back `skipped: true` -- as import_commit_row does on a
    // retried batch that was already fully committed by an earlier attempt.
    // Nothing landed this call, so refetching the caches above would just be
    // wasted work, not a correctness fix.
    mockedCommit.mockImplementation(async (_job, rows) => ({
      results: rows.map((r) => ({ sourceKey: r.sourceKey, table: 'x', rowId: '1', skipped: true })),
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await advanceToPreview(qc);
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('reports a plan-limit failure in words the user can act on', async () => {
    mockedCommit.mockImplementation(async (_job, rows, final) => ({
      results: final
        ? [
            ...okResults(rows.slice(1)),
            {
              sourceKey: rows[0].sourceKey,
              table: null,
              rowId: null,
              skipped: false,
              failed: true,
              reason: 'plan_limit:max_posts_per_workflow',
            },
          ]
        : okResults(rows),
    }));

    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));

    await screen.findByText('Importação concluída');
    expect(screen.getByText(/Limite do plano atingido: posts por fluxo/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Baixar relatório de falhas (CSV)' }),
    ).toBeInTheDocument();
  });

  // A commit that returns PER-ROW failures lands in the completed state, not
  // the error state — so before this, the only way forward was restarting the
  // wizard, which opens a NEW job. None of this job's rows are recorded against
  // that id, so every row that already succeeded would be inserted twice.
  test('retries the failed rows on the SAME job instead of starting a new import', async () => {
    mockedCommit.mockImplementation(async (_job, rows, final) => ({
      results: final
        ? [
            ...okResults(rows.slice(1)),
            {
              sourceKey: rows[0].sourceKey,
              table: null,
              rowId: null,
              skipped: false,
              failed: true,
              reason: 'plan_limit:max_posts_per_workflow',
            },
          ]
        : okResults(rows),
    }));

    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    expect(mockedStart).toHaveBeenCalledTimes(1);
    mockedCommit.mockClear();

    // Second run succeeds outright, so the failure block disappears.
    mockedCommit.mockImplementation(async (_job, rows) => ({ results: okResults(rows) }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Tentar novamente as linhas que falharam' }),
    );

    await waitFor(() =>
      expect(screen.queryByText(/Limite do plano atingido/)).not.toBeInTheDocument(),
    );

    // THE POINT OF THE FIX: no second job, and every retried batch carries the
    // original job id — which is what makes import_commit_row's per-row
    // idempotency apply and stops the successful rows being re-inserted.
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(mockedCommit).toHaveBeenCalledTimes(2);
    for (const [jobId] of mockedCommit.mock.calls) expect(jobId).toBe(42);
  });

  test('lets the user retry after a failed batch', async () => {
    mockedCommit.mockRejectedValueOnce(new Error('boom'));

    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));

    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    fireEvent.click(retry);

    await screen.findByText('Importação concluída');
    // The retry reuses the job (idempotent server-side) instead of starting a new one.
    expect(mockedStart).toHaveBeenCalledTimes(1);
  });

  // startImport opens a job in status 'committing' and ONLY a batch sent with
  // `final: true` closes it. If every source row is dropped while building the
  // commit rows (here: a posts collection whose client column is blank on every
  // row), a job created for that empty array would never receive a final batch
  // and would sit in 'committing' forever, with the UI spinning. The prévia
  // button is what makes this unreachable — this test is what keeps it that way.
  test('never opens a job when every source row was dropped while building', async () => {
    parseGenericCsv.mockReturnValue({
      ...calendarCollection(),
      rows: Array.from({ length: 5 }, (_, i) => ({
        key: `r${i + 1}`,
        cells: { Nome: `Post ${i + 1}`, Cliente: '', Data: '01/08/2026' },
      })),
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Planilha (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.change(screen.getByLabelText('Arquivos de exportação'), {
      target: { files: [new File(['a,b'], 'calendario.csv')] },
    });
    await screen.findByText('1 coleção · 5 linhas');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('calendario');
    // The heuristic no longer binds an all-blank client column (it proposes the
    // fixed picker, which blocks the step) — so the only route left into
    // "every row drops during the build" is the user explicitly choosing that
    // column, which the mapping step allows. Drive exactly that.
    fireEvent.click(screen.getByRole('button', { name: 'Coluna “Cliente”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Prévia da importação');

    // Every one of the 5 rows dropped, so there is nothing to commit. Like the
    // Importar button in advanceToPreview, this line renders only after the
    // preview settles — the heading above appears on the step switch, so it must
    // be awaited, not asserted synchronously.
    await screen.findByText(/5 linhas serão ignoradas/);

    // Layer 1 — the button the user sees is disabled...
    const importar = screen.getByRole('button', { name: /Importar/ });
    expect(importar).toBeDisabled();

    // ...layer 2 — and even driven directly, the commit refuses to open a job
    // rather than opening one it could never send a `final: true` batch for.
    // (Asserted on the calls, not on what is rendered, so this still holds if
    // the disabled attribute above ever regresses.)
    fireEvent.click(importar);
    await waitFor(() => expect(mockedPreview).toHaveBeenCalled());
    expect(mockedStart).not.toHaveBeenCalled();
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  test('tells the user what undo kept and why', async () => {
    mockedUndo.mockResolvedValue({
      deleted: 250,
      skippedPublished: ['1', '2'],
      skippedWorkflows: [],
      skippedTemplates: [],
      skippedClientes: ['9'],
    });

    await advanceToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer importação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e desfazer' }));

    await screen.findByText('250 registros removidos.');
    expect(mockedUndo).toHaveBeenCalledWith(42);
    expect(screen.getByText(/2 posts mantidos/)).toBeInTheDocument();
    expect(screen.getByText(/1 cliente mantido/)).toBeInTheDocument();
    expect(screen.queryByText(/modelos de fluxo mantidos/)).not.toBeInTheDocument();
  });

  test('invalidates the CRM caches an import can affect after an undo that deletes rows', async () => {
    mockedUndo.mockResolvedValue({
      deleted: 250,
      skippedPublished: [],
      skippedWorkflows: [],
      skippedTemplates: [],
      skippedClientes: [],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await advanceToPreview(qc);
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer importação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e desfazer' }));
    await screen.findByText('250 registros removidos.');

    for (const queryKey of IMPORT_AFFECTED_KEYS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  test('does not invalidate anything when an undo deletes nothing', async () => {
    // `deleted: 0` -- e.g. every row in the job was already undone by a prior,
    // interrupted attempt (import_commit_row/undo is resumable).
    mockedUndo.mockResolvedValue({
      deleted: 0,
      skippedPublished: [],
      skippedWorkflows: [],
      skippedTemplates: [],
      skippedClientes: [],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await advanceToPreview(qc);
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }));
    await screen.findByText('Importação concluída');

    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer importação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e desfazer' }));
    await screen.findByText('0 registros removidos.');

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test('shows the upgrade nudge instead of the wizard when the plan lacks the feature', async () => {
    entitlements.csvImport = false;
    renderPage();

    expect(
      await screen.findByText('A importação de dados não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Planilha (CSV)' })).not.toBeInTheDocument();
  });

  test('keeps the user on the upload step when a file cannot be parsed', async () => {
    parseGenericCsv.mockImplementation(() => {
      throw new Error('bad csv');
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Planilha (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.change(screen.getByLabelText('Arquivos de exportação'), {
      target: { files: [new File(['x'], 'quebrado.csv')] },
    });

    await screen.findByText(
      'Não conseguimos ler o arquivo "quebrado.csv". Confira o passo a passo de exportação acima.',
    );
    expect(screen.getByLabelText('Arquivos de exportação')).toBeInTheDocument();
    await waitFor(() => expect(mockedAnalyze).not.toHaveBeenCalled());
  });

  test('MCP callout is visible on step 1 with links to /configuracao/mcp and the KB article', async () => {
    renderPage();
    expect(
      await screen.findByText('O jeito mais completo de migrar: peça para um agente de IA'),
    ).toBeInTheDocument();
    const mcpLink = screen.getByText('Conectar um agente');
    expect(mcpLink.closest('a')).toHaveAttribute('href', '/configuracao/mcp');
    const howLink = screen.getByText('Como funciona');
    expect(howLink.closest('a')).toHaveAttribute('href', '/ajuda/como-conectar-o-claude-mcp');
  });

  // An unresolved or failed clientes list silently resolves every referenced
  // name to "created" instead of "existing", turning a merge into a duplicate
  // client — see buildCommitRows.ts. Advancing must be unreachable until the
  // list has loaded successfully.
  test('blocks advancing past mapping while the clientes list is still loading', async () => {
    vi.mocked(getClientes).mockReturnValue(new Promise(() => {})); // never resolves

    await advanceToMapping();

    expect(screen.getByText(/Carregando a lista de clientes existentes/)).toBeInTheDocument();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();

    fireEvent.click(continuar);
    expect(mockedPreview).not.toHaveBeenCalled();
    expect(screen.queryByText('Prévia da importação')).not.toBeInTheDocument();
  });

  test('blocks advancing and offers a retry when the clientes list fails to load', async () => {
    vi.mocked(getClientes).mockRejectedValueOnce(new Error('network down'));

    await advanceToMapping();

    expect(
      screen.getByText(/Não foi possível carregar a lista de clientes existentes/),
    ).toBeInTheDocument();
    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();

    fireEvent.click(continuar);
    expect(mockedPreview).not.toHaveBeenCalled();

    // Retrying succeeds (beforeEach's default mock takes over past the
    // one-shot rejection) and unblocks the wizard.
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(continuar).not.toBeDisabled());

    fireEvent.click(continuar);
    await screen.findByText('Prévia da importação');
  });
});
