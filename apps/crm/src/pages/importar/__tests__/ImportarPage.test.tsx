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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** Drives origem -> upload -> mapeamento -> prévia. */
async function advanceToPreview() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Planilha (CSV)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  const input = screen.getByLabelText('Arquivos de exportação');
  fireEvent.change(input, { target: { files: [new File(['a,b'], 'calendario.csv')] } });
  await screen.findByText(`1 coleção · ${POST_COUNT} linhas`);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  await screen.findByText('calendario');
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByText('Prévia da importação');
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
      'Não conseguimos ler este arquivo — confira o passo a passo de exportação acima.',
    );
    expect(screen.getByLabelText('Arquivos de exportação')).toBeInTheDocument();
    await waitFor(() => expect(mockedAnalyze).not.toHaveBeenCalled());
  });
});
