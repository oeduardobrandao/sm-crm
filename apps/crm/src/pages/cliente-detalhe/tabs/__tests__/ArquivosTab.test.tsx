import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { FileRecord, Folder, FolderContents } from '@/pages/arquivos/types';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// ArquivosTab is `ClienteArquivosSection` ported verbatim out of the
// pre-split ClienteDetalhePage (see git history at d30adeea): a capped
// (12-item) preview of the client's root folder in Arquivos, with a "Ver
// mais"/viewAll affordance that has always just navigated to /arquivos —
// never real in-page pagination. This suite preserves that, including the
// `.single()` call on the `folders` lookup with no `error` check: "no
// folder yet" and a genuine RLS/network failure both fall through to the
// same empty state today, and this task does not change that.

vi.mock('@/lib/supabase');

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const { getFolderContentsMock } = vi.hoisted(() => ({ getFolderContentsMock: vi.fn() }));
vi.mock('@/services/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/fileService')>()),
  getFolderContents: (...args: unknown[]) => getFolderContentsMock(...args),
}));

// FileGrid has its own render suite; stub it here (same convention as
// RedesSociaisTab.test.tsx mocking InstagramSection) so this suite can focus
// on the query/composition logic that actually belongs to ArquivosTab.
vi.mock('@/pages/arquivos/components/FileGrid', () => ({
  FileGrid: ({ files, subfolders }: { files: FileRecord[]; subfolders: Folder[] }) => (
    <div data-testid="file-grid">
      files:{files.map((f) => f.name).join(',')}|subfolders:
      {subfolders.map((f) => f.name).join(',')}
    </div>
  ),
}));

import { __queueSupabaseResult, __resetSupabaseMock } from '@/lib/supabase';
import ArquivosTab from '../ArquivosTab';

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
};

function makeFile(id: number): FileRecord {
  return {
    id,
    conta_id: 'conta-42',
    folder_id: 7,
    r2_key: `k-${id}`,
    thumbnail_r2_key: null,
    name: `arquivo-${id}.png`,
    kind: 'image',
    mime_type: 'image/png',
    size_bytes: 100,
    width: null,
    height: null,
    duration_seconds: null,
    blur_data_url: null,
    uploaded_by: null,
    reference_count: 0,
    created_at: '2026-08-01T00:00:00Z',
  };
}

function makeFolder(id: number, name: string): Folder {
  return {
    id,
    conta_id: 'conta-42',
    parent_id: 7,
    name,
    source: 'user',
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  };
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderTab(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<ArquivosTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetSupabaseMock();
});

describe('ArquivosTab', () => {
  it('no folder yet: shows the empty state, no "Ver todos" link, and fires no folder-contents query', async () => {
    __queueSupabaseResult('folders', 'select', { data: null, error: null });
    renderTab();

    expect(
      await screen.findByText('Nenhum arquivo encontrado para este cliente.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ver todos')).not.toBeInTheDocument();
    expect(getFolderContentsMock).not.toHaveBeenCalled();
  });

  it('folder lookup fails (RLS/network error, no error check): same empty state as "no folder"', async () => {
    __queueSupabaseResult('folders', 'select', {
      data: null,
      error: { message: 'permission denied' },
    });
    renderTab();

    expect(
      await screen.findByText('Nenhum arquivo encontrado para este cliente.'),
    ).toBeInTheDocument();
    expect(getFolderContentsMock).not.toHaveBeenCalled();
  });

  it('folder exists but is empty: shows "Ver todos" link and the empty-state text', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [],
      files: [],
      breadcrumbs: [],
    } satisfies FolderContents);
    renderTab();

    expect(await screen.findByText('Ver todos')).toBeInTheDocument();
    expect(
      await screen.findByText('Nenhum arquivo encontrado para este cliente.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(getFolderContentsMock).toHaveBeenCalledWith(7));
  });

  it('shows a loading spinner while folder-contents is in flight', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    getFolderContentsMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderTab();

    await screen.findByText('Ver todos');
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('file-grid')).not.toBeInTheDocument();
  });

  it('renders up to 12 files/subfolders via FileGrid, with no "Ver mais" button', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [makeFolder(1, 'Pasta A')],
      files: [makeFile(1), makeFile(2)],
      breadcrumbs: [],
    } satisfies FolderContents);
    renderTab();

    expect(await screen.findByTestId('file-grid')).toHaveTextContent(
      'files:arquivo-1.png,arquivo-2.png|subfolders:Pasta A',
    );
    expect(screen.queryByText(/Ver mais/)).not.toBeInTheDocument();
  });

  it('caps the FileGrid preview at 12 files and shows "Ver mais N arquivos" for the remainder', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    const files = Array.from({ length: 15 }, (_, i) => makeFile(i + 1));
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [],
      files,
      breadcrumbs: [],
    } satisfies FolderContents);
    renderTab();

    const grid = await screen.findByTestId('file-grid');
    expect(grid).toHaveTextContent(
      files
        .slice(0, 12)
        .map((f) => f.name)
        .join(','),
    );
    expect(grid).not.toHaveTextContent('arquivo-13.png');

    expect(screen.getByText('Ver mais 3 arquivos')).toBeInTheDocument();
  });

  it('"Ver mais" navigates to /arquivos — it is a link, not real pagination', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    const files = Array.from({ length: 15 }, (_, i) => makeFile(i + 1));
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [],
      files,
      breadcrumbs: [],
    } satisfies FolderContents);
    renderTab();

    fireEvent.click(await screen.findByText('Ver mais 3 arquivos'));
    expect(navigateMock).toHaveBeenCalledWith('/arquivos');
  });

  it('"Ver todos" also navigates to /arquivos', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [],
      files: [makeFile(1)],
      breadcrumbs: [],
    } satisfies FolderContents);
    renderTab();

    fireEvent.click(await screen.findByText('Ver todos'));
    expect(navigateMock).toHaveBeenCalledWith('/arquivos');
  });

  it('fires only client-folder and folder-contents queries — nothing from Hub/Entregas/Financeiro/Instagram', async () => {
    __queueSupabaseResult('folders', 'select', { data: { id: 7 }, error: null });
    getFolderContentsMock.mockResolvedValue({
      folder: null,
      subfolders: [],
      files: [makeFile(1)],
      breadcrumbs: [],
    } satisfies FolderContents);
    const { queryClient } = renderTab();
    await screen.findByTestId('file-grid');

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0]);
    expect(new Set(keys)).toEqual(new Set(['client-folder', 'folder-contents']));
  });
});
