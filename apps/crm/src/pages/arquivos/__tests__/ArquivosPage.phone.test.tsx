import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Phone branch of /arquivos (below 768px, PLAN F2c). jsdom's matchMedia reports false,
// so useIsDesktop is false here without a mock.

vi.mock('@/services/fileService', () => ({
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
  uploadFile: vi.fn(),
  renameFile: vi.fn(),
  renameFolder: vi.fn(),
  deleteFile: vi.fn(),
  deleteFolder: vi.fn(),
  bulkDelete: vi.fn(),
  bulkMove: vi.fn(),
  copyFile: vi.fn(),
  copyFolder: vi.fn(),
  requestZipToken: vi.fn(),
  getTreeChildren: vi.fn(),
  getFileDownloadUrl: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => false }));
// The real shell actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import {
  bulkDelete,
  bulkMove,
  createFolder,
  getFolderContents,
  getTreeChildren,
  renameFile,
} from '@/services/fileService';
import type { FolderContents, Folder, FileRecord } from '../types';
import ArquivosPage from '../ArquivosPage';

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Identidade visual',
    source: 'user',
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    file_count: 6,
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 100,
    conta_id: 'conta-1',
    folder_id: null,
    r2_key: 'files/vitrine.jpg',
    thumbnail_r2_key: null,
    name: 'vitrine.jpg',
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 2_202_009,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    blur_data_url: null,
    uploaded_by: null,
    reference_count: 0,
    created_at: '2026-04-01T00:00:00Z',
    url: 'https://media.test/vitrine.jpg',
    ...overrides,
  };
}

const ROOT: FolderContents = {
  folder: null,
  subfolders: [makeFolder()],
  files: [
    makeFile(),
    makeFile({
      id: 101,
      name: 'cardapio.pdf',
      kind: 'document',
      mime_type: 'application/pdf',
      size_bytes: 640_000,
      created_at: '2026-05-01T00:00:00Z',
    }),
  ],
  breadcrumbs: [],
  storage: { used_bytes: 2_400_000_000, quota_bytes: 10_000_000_000 },
} as FolderContents;

const INSIDE: FolderContents = {
  folder: makeFolder() as never,
  subfolders: [],
  files: [makeFile({ id: 200, name: 'logo.png', mime_type: 'image/png', folder_id: 1 })],
  breadcrumbs: [{ id: 1, name: 'Identidade visual' }],
  storage: { used_bytes: 2_400_000_000, quota_bytes: 10_000_000_000 },
} as FolderContents;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(entry = '/arquivos') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <ArquivosPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getFolderContents).mockReset();
  vi.mocked(getFolderContents).mockImplementation(async (id) => (id === 1 ? INSIDE : ROOT));
  vi.mocked(createFolder)
    .mockReset()
    .mockResolvedValue({ id: 9 } as never);
  vi.mocked(renameFile)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(bulkDelete).mockReset();
  vi.mocked(bulkMove)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(getTreeChildren)
    .mockReset()
    .mockResolvedValue([makeFolder()] as never);
  useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'owner' })) });
});

const list = (name: 'Pastas' | 'Arquivos') =>
  within(screen.getByRole('region', { name })).getAllByRole('listitem');

describe('ArquivosPage on phones', () => {
  it('renders the page header, folders then files, and no dead search button', async () => {
    renderPage();
    await screen.findByText('vitrine.jpg');
    expect(screen.getByRole('heading', { level: 1, name: 'Arquivos' })).toBeInTheDocument();
    expect(screen.getByText(/1 pasta · 2 arquivos · .* usados/)).toBeInTheDocument();
    expect(list('Pastas')).toHaveLength(1);
    expect(list('Pastas')[0]).toHaveTextContent('Identidade visual6 arquivos');
    expect(list('Arquivos')).toHaveLength(2);
    expect(screen.getByText('JPG · 2.1 MB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /buscar/i })).not.toBeInTheDocument();
    // The desktop folder tree is not rendered on phones.
    expect(screen.queryByText('Todos os Arquivos')).not.toBeInTheDocument();
  });

  it('opens a folder as a pushed screen in the URL, with Back to the parent', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Identidade visual'));
    await screen.findByText('logo.png');
    expect(screen.getByTestId('location')).toHaveTextContent('/arquivos?pasta=1');
    expect(getFolderContents).toHaveBeenCalledWith(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Identidade visual' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Arquivos' }));
    await screen.findByText('vitrine.jpg');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/arquivos$/);
  });

  it('Back from a folder opened directly goes to its parent', async () => {
    renderPage('/arquivos?pasta=1');
    await screen.findByText('logo.png');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Arquivos' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/arquivos$/));
  });

  it('"+" Nova pasta at the root creates it at the root', async () => {
    const { unmount } = renderPage();
    await screen.findByText('vitrine.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova pasta' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nova pasta' });
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'Reels' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('Reels', null));
    unmount();
  });

  it('"+" Nova pasta inside a folder creates it there', async () => {
    renderPage('/arquivos?pasta=1');
    await screen.findByText('logo.png');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova pasta' }));
    const inner = await screen.findByRole('dialog', { name: 'Nova pasta' });
    fireEvent.change(within(inner).getByLabelText('Nome'), { target: { value: 'Logos' } });
    fireEvent.click(within(inner).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('Logos', 1));
  });

  it('"Enviar arquivo" opens the file picker inside the tap', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderPage('/arquivos?pasta=1');
    await screen.findByText('logo.png');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar arquivo' }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('reaches Renomear, Informações, Download, Mover, Copiar and Excluir from the item menu', async () => {
    renderPage();
    await screen.findByText('vitrine.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Ações de vitrine.jpg' }));
    const menu = await screen.findByRole('menu', { name: 'Ações de vitrine.jpg' });
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent);
    expect(items).toEqual([
      'Renomear',
      'Informações',
      'Download',
      'Mover para…',
      'Copiar para…',
      'Excluir',
    ]);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Renomear' }));
    const sheet = await screen.findByRole('dialog', { name: 'Renomear arquivo' });
    const field = within(sheet).getByLabelText('Nome');
    expect(field).toHaveValue('vitrine.jpg');
    fireEvent.change(field, { target: { value: 'vitrine-01.jpg' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(renameFile).toHaveBeenCalledWith(100, 'vitrine-01.jpg'));
  });

  it('moves one item from its menu through the folder picker sheet', async () => {
    renderPage();
    await screen.findByText('cardapio.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Ações de cardapio.pdf' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mover para…' }));
    const picker = await screen.findByRole('dialog', { name: 'Mover 1 item' });
    // The root is where the item already is: not a destination.
    expect(within(picker).getByRole('button', { name: 'Mover' })).toBeDisabled();
    fireEvent.click(await within(picker).findByRole('button', { name: /Identidade visual/ }));
    await waitFor(() =>
      expect(within(picker).getByRole('button', { name: 'Mover' })).toBeEnabled(),
    );
    fireEvent.click(within(picker).getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(bulkMove).toHaveBeenCalledWith([101], [], 1));
  });

  it('Selecionar mode: toggles rows, shows the bulk bar and deletes in two stages', async () => {
    vi.mocked(bulkDelete)
      .mockResolvedValueOnce({
        blocked: [{ id: 100, type: 'file', reason: 'in_use' }],
        deletable: { file_ids: [101], folder_ids: [] },
      } as never)
      .mockResolvedValueOnce({ files_deleted: 1, folders_deleted: 0 } as never);
    renderPage();
    await screen.findByText('vitrine.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    expect(screen.getByText('Toque nos itens para selecionar')).toBeInTheDocument();
    // Menus step aside while selecting.
    expect(screen.queryByRole('button', { name: 'Ações de vitrine.jpg' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar vitrine.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar cardapio.pdf' }));
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selecionar vitrine.jpg' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const bar = screen.getByRole('toolbar', { name: 'Ações para 2 itens' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Mover', 'Copiar', 'ZIP', 'Excluir']);

    fireEvent.click(within(bar).getByRole('button', { name: 'Excluir' }));
    const confirm = await screen.findByRole('dialog', { name: 'Excluir itens?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith([100, 101], []));

    const partial = await screen.findByRole('dialog', {
      name: 'Alguns itens não podem ser excluídos',
    });
    expect(partial).toHaveTextContent('1 item está em uso e não pode ser excluído.');
    fireEvent.click(within(partial).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(bulkDelete).toHaveBeenLastCalledWith([101], []));
    // The selection was cleared by the delete: the mode ends with it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Selecionar' })).toBeInTheDocument(),
    );
  });

  it('sorts and switches to the grid from the "…" sheet, and filters by type', async () => {
    renderPage();
    await screen.findByText('vitrine.jpg');
    expect(list('Arquivos').map((li) => li.textContent)).toEqual([
      expect.stringContaining('cardapio.pdf'),
      expect.stringContaining('vitrine.jpg'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar e visualizar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ordenar por tamanho' }));
    await waitFor(() => expect(list('Arquivos')[0]).toHaveTextContent('vitrine.jpg'));

    fireEvent.click(screen.getByRole('button', { name: 'Ordenar e visualizar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver em grade' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'vitrine.jpg' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('tab', { name: /Documentos/ }));
    expect(list('Arquivos')).toHaveLength(1);
    expect(list('Arquivos')[0]).toHaveTextContent('cardapio.pdf');
  });

  it('a custom role without arquivos:editar gets no "+", read-only menus and only ZIP', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderPage();
    await screen.findByText('vitrine.jpg');
    expect(screen.queryByRole('button', { name: 'Adicionar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ações de vitrine.jpg' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.textContent),
    ).toEqual(['Informações', 'Download']);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar vitrine.jpg' }));
    const bar = screen.getByRole('toolbar');
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['ZIP']);
  });
});
