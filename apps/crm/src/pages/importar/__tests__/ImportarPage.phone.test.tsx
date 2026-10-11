import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportCollection } from '@mesaas/import-parsers';
import type { CommitRow } from '@/services/dataImport';

// Phone wizard of /importar (below 768px, PLAN F2c / F5.5). jsdom's matchMedia reports
// false, so useIsDesktop is false here without a mock.

const { parseGenericCsv } = vi.hoisted(() => ({ parseGenericCsv: vi.fn() }));
vi.mock('@mesaas/import-parsers', async (importOriginal) => {
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
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ hasFeature: () => true, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
// The real shell actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import ImportarPage from '../ImportarPage';
import { getClientes } from '@/store';
import {
  analyzeImport,
  commitBatch,
  previewImport,
  startImport,
  undoImport,
} from '@/services/dataImport';

function calendarCollection(): ImportCollection {
  return {
    id: 'calendario.csv',
    name: 'calendario',
    source: 'csv',
    columns: ['Nome', 'Cliente', 'Status'],
    listNames: [],
    rows: [
      { key: 'r1', cells: { Nome: 'Post 1', Cliente: 'Ana', Status: 'A fazer' } },
      { key: 'r2', cells: { Nome: 'Post 2', Cliente: 'Ana', Status: 'Aprovado' } },
    ],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ImportarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bar = () => screen.getByRole('group', { name: 'Navegação do assistente' });

async function advanceToMapping() {
  renderPage();
  fireEvent.click(await screen.findByRole('radio', { name: /Planilha \(CSV\)/ }));
  fireEvent.click(within(bar()).getByRole('button', { name: 'Continuar' }));
  fireEvent.change(screen.getByLabelText('Arquivos de exportação', { selector: 'input' }), {
    target: { files: [new File(['a,b'], 'calendario.csv')] },
  });
  await screen.findByText('1 coleção · 2 linhas');
  await waitFor(() =>
    expect(within(bar()).getByRole('button', { name: 'Continuar' })).toBeEnabled(),
  );
  fireEvent.click(within(bar()).getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'calendario' });
}

beforeEach(() => {
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
  vi.mocked(analyzeImport).mockResolvedValue({ proposal: null });
  vi.mocked(previewImport).mockResolvedValue({
    counts: { clientes: 0, posts: 2, entregas: 0, ideias: 0 },
    warnings: [],
    limits: {
      maxClients: null,
      maxWorkflowTemplates: null,
      maxPostsPerWorkflow: 100,
      maxActiveWorkflowsPerClient: null,
    },
  });
  vi.mocked(startImport).mockResolvedValue({ jobId: 42 });
  vi.mocked(commitBatch).mockImplementation(async (_job, rows: CommitRow[]) => ({
    results: rows.map((r) => ({ sourceKey: r.sourceKey, table: 'x', rowId: '1', skipped: false })),
  }));
  vi.mocked(undoImport).mockReset();
});

describe('ImportarPage on phones', () => {
  test('page header with "Passo N de 5", step bars, and origem as radio cells', async () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Importar dados' })).toBeInTheDocument();
    expect(screen.getByText('Passo 1 de 5 · Origem')).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Passos' })).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    // No desktop container padding on phones.
    expect(container.querySelector('.p-6')).toBeNull();
    // The MCP callout keeps its links.
    expect(screen.getByRole('link', { name: 'Conectar um agente' })).toHaveAttribute(
      'href',
      '/configuracao/mcp',
    );

    const continuar = within(bar()).getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();
    expect(within(bar()).queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();

    const csv = screen.getByRole('radio', { name: /Planilha \(CSV\)/ });
    expect(csv).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(csv);
    expect(csv).toHaveAttribute('aria-checked', 'true');
    expect(continuar).toBeEnabled();
    // The export guide for the chosen source shows up.
    expect(screen.getByText(/Como exportar do/)).toBeInTheDocument();

    fireEvent.click(continuar);
    expect(screen.getByText('Passo 2 de 5 · Arquivos')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Passo 1 de 5 · Origem')).toBeInTheDocument();
  });

  test('mapping as drill-in picker cells, the fixed-client name row and status equivalence', async () => {
    await advanceToMapping();
    expect(screen.getByText('Passo 3 de 5 · Mapeamento')).toBeInTheDocument();
    // Importar como: pick Posts in the drill-in sheet; posts bring the status equivalence.
    fireEvent.click(screen.getByRole('button', { name: /^Importar como/ }));
    const postsSheet = await screen.findByRole('dialog', { name: 'Importar calendario como' });
    fireEvent.click(within(postsSheet).getByRole('button', { name: 'Posts' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Importar como\s*Posts/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'Equivalência de status' })).toBeInTheDocument();

    // Status equivalence: "A fazer" -> pick "Em correção".
    fireEvent.click(screen.getByRole('button', { name: /^A fazer/ }));
    const statusSheet = await screen.findByRole('dialog', { name: 'Status "A fazer"' });
    fireEvent.click(within(statusSheet).getByRole('button', { name: 'Em correção' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^A fazer\s*Em correção/ })).toBeInTheDocument(),
    );

    // Cliente: switch to one fixed client; an empty name blocks Continuar with the desktop error.
    fireEvent.click(screen.getByRole('button', { name: /^Cliente\s*Coluna/ }));
    const clienteSheet = await screen.findByRole('dialog', { name: 'Cliente de calendario' });
    fireEvent.click(
      within(clienteSheet).getByRole('button', { name: 'Um cliente para todas as linhas' }),
    );
    const nome = await screen.findByLabelText('Nome do cliente de calendario');
    await waitFor(() =>
      expect(within(bar()).getByRole('button', { name: 'Continuar' })).toBeEnabled(),
    );
    fireEvent.click(within(bar()).getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha o cliente de: calendario.');

    fireEvent.change(nome, { target: { value: 'Ana' } });
    expect(screen.getByText('Usaremos o cliente que já existe com esse nome.')).toBeInTheDocument();

    // Importar como: Ignorar hides the client rows.
    fireEvent.click(screen.getByRole('button', { name: /^Importar como/ }));
    const destSheet = await screen.findByRole('dialog', { name: 'Importar calendario como' });
    fireEvent.click(within(destSheet).getByRole('button', { name: 'Ignorar' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Nome do cliente de calendario')).not.toBeInTheDocument(),
    );
  });

  test('prévia, import, then undo through a confirmation sheet', async () => {
    vi.mocked(undoImport).mockResolvedValue({
      deleted: 3,
      skippedPublished: [],
      skippedWorkflows: [],
      skippedTemplates: [],
      skippedClientes: [],
    } as never);
    await advanceToMapping();
    await waitFor(() =>
      expect(within(bar()).getByRole('button', { name: 'Continuar' })).toBeEnabled(),
    );
    fireEvent.click(within(bar()).getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Passo 4 de 5 · Prévia');
    const importar = await within(bar()).findByRole('button', {
      name: /^Importar \d+ registros?$/,
    });
    await waitFor(() => expect(importar).toBeEnabled());
    const counts = screen.getByRole('list', { name: 'Prévia da importação' });
    expect(
      within(counts)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Clientes0', 'Posts2', 'Entregas0', 'Ideias0']);

    fireEvent.click(importar);
    await screen.findByText('Importação concluída');
    expect(screen.getByText('Passo 5 de 5 · Importar')).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Navegação do assistente' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer importação' }));
    const sheet = await screen.findByRole('dialog', { name: 'Desfazer importação?' });
    expect(undoImport).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar e desfazer' }));
    await waitFor(() => expect(undoImport).toHaveBeenCalledWith(42));
    expect(await screen.findByText('3 registros removidos.')).toBeInTheDocument();
  });
});
