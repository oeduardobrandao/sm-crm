import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getFolderContents, createFolder } from '@/services/fileService';
import { FolderTree } from '../components/FolderTree';

const mockedGetFolderContents = vi.mocked(getFolderContents);
const mockedCreateFolder = vi.mocked(createFolder);

function makeFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Pasta Teste',
    source: 'user' as const,
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('FolderTree', () => {
  beforeEach(() => {
    mockedGetFolderContents.mockReset();
    mockedCreateFolder.mockReset();
  });

  it('renders root folders after loading', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [
        makeFolder({ id: 1, name: 'Clientes' }),
        makeFolder({ id: 2, name: 'Campanhas' }),
      ],
      files: [],
      breadcrumbs: [],
    });

    const onSelectFolder = vi.fn();
    render(
      <FolderTree selectedFolderId={null} onSelectFolder={onSelectFolder} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Clientes')).toBeInTheDocument();
    });
    expect(screen.getByText('Campanhas')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockedGetFolderContents.mockReturnValue(new Promise(() => {}));

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });

  it('shows AUTO badge for system folders', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [
        makeFolder({ id: 1, name: 'Pastas Automáticas', source: 'system' }),
        makeFolder({ id: 2, name: 'Minha Pasta', source: 'user' }),
      ],
      files: [],
      breadcrumbs: [],
    });

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Pastas Automáticas')).toBeInTheDocument();
    });

    expect(screen.getByText('AUTO')).toBeInTheDocument();
  });

  it('clicking folder calls onSelectFolder', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [makeFolder({ id: 5, name: 'Minha Pasta' })],
      files: [],
      breadcrumbs: [],
    });

    const onSelectFolder = vi.fn();
    render(
      <FolderTree selectedFolderId={null} onSelectFolder={onSelectFolder} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Minha Pasta')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Minha Pasta'));
    expect(onSelectFolder).toHaveBeenCalledWith(5);
  });

  it('selected folder is visually highlighted', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [makeFolder({ id: 3, name: 'Selecionada' })],
      files: [],
      breadcrumbs: [],
    });

    render(
      <FolderTree selectedFolderId={3} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Selecionada')).toBeInTheDocument();
    });

    // The parent container of the selected folder gets the primary background class
    const folderText = screen.getByText('Selecionada');
    const row = folderText.closest('[class*="bg-[var(--primary-color)]"]');
    expect(row).toBeTruthy();
  });

  it('toggling expand loads children and shows them', async () => {
    // Root call
    mockedGetFolderContents.mockResolvedValueOnce({
      folder: null,
      subfolders: [makeFolder({ id: 1, name: 'Parent' })],
      files: [],
      breadcrumbs: [],
    });

    // Expanded children call
    mockedGetFolderContents.mockResolvedValueOnce({
      folder: makeFolder({ id: 1, name: 'Parent' }),
      subfolders: [makeFolder({ id: 10, name: 'Child Folder', parent_id: 1 })],
      files: [],
      breadcrumbs: [{ id: 1, name: 'Parent' }],
    });

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Parent')).toBeInTheDocument();
    });

    // Click the expand button
    const expandBtn = screen.getByLabelText('Expandir');
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText('Child Folder')).toBeInTheDocument();
    });

    // Now the button should say "Recolher"
    expect(screen.getByLabelText('Recolher')).toBeInTheDocument();
  });

  it('shows empty state when there are no folders', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [],
      files: [],
      breadcrumbs: [],
    });

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhuma pasta')).toBeInTheDocument();
    });
  });

  it('renders "Nova pasta" button at the bottom', async () => {
    mockedGetFolderContents.mockResolvedValue({
      folder: null,
      subfolders: [],
      files: [],
      breadcrumbs: [],
    });

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Nova pasta')).toBeInTheDocument();
    });
  });
});
