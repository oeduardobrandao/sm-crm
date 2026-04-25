import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  getTreeChildren: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getTreeChildren } from '@/services/fileService';
import { FolderTree } from '../components/FolderTree';

const mockedGetTreeChildren = vi.mocked(getTreeChildren);

function makeTreeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Pasta Teste',
    source: 'user' as const,
    source_type: null as string | null,
    position: 0,
    has_children: false,
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
    mockedGetTreeChildren.mockReset();
  });

  it('renders root folders after loading', async () => {
    mockedGetTreeChildren.mockResolvedValue([
      makeTreeNode({ id: 1, name: 'Clientes' }),
      makeTreeNode({ id: 2, name: 'Campanhas' }),
    ]);

    const onSelectFolder = vi.fn();
    render(
      <FolderTree selectedFolderId={null} onSelectFolder={onSelectFolder} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Clientes')).toBeInTheDocument();
    });
    expect(screen.getByText('Campanhas')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockedGetTreeChildren.mockReturnValue(new Promise(() => {}));

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });

  it('shows AUTO badge for system folders', async () => {
    mockedGetTreeChildren.mockResolvedValue([
      makeTreeNode({ id: 1, name: 'Pastas Automáticas', source: 'system' }),
      makeTreeNode({ id: 2, name: 'Minha Pasta', source: 'user' }),
    ]);

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Pastas Automáticas')).toBeInTheDocument();
    });

    expect(screen.getByText('AUTO')).toBeInTheDocument();
  });

  it('clicking folder calls onSelectFolder', async () => {
    mockedGetTreeChildren.mockResolvedValue([
      makeTreeNode({ id: 5, name: 'Minha Pasta' }),
    ]);

    const onSelectFolder = vi.fn();
    render(
      <FolderTree selectedFolderId={null} onSelectFolder={onSelectFolder} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Minha Pasta')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Minha Pasta'));
    expect(onSelectFolder).toHaveBeenCalledWith(5);
  });

  it('selected folder is visually highlighted', async () => {
    mockedGetTreeChildren.mockResolvedValue([
      makeTreeNode({ id: 3, name: 'Selecionada' }),
    ]);

    render(
      <FolderTree selectedFolderId={3} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Selecionada')).toBeInTheDocument();
    });

    const folderText = screen.getByText('Selecionada');
    const row = folderText.closest('[class*="bg-[var(--primary-color)]"]');
    expect(row).toBeTruthy();
  });

  it('toggling expand loads children and shows them', async () => {
    // Root call
    mockedGetTreeChildren.mockResolvedValueOnce([
      makeTreeNode({ id: 1, name: 'Parent', has_children: true }),
    ]);

    // Expanded children call
    mockedGetTreeChildren.mockResolvedValueOnce([
      makeTreeNode({ id: 10, name: 'Child Folder' }),
    ]);

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Parent')).toBeInTheDocument();
    });

    const expandBtn = screen.getByLabelText('Expandir');
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText('Child Folder')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Recolher')).toBeInTheDocument();
  });

  it('shows empty state when there are no folders', async () => {
    mockedGetTreeChildren.mockResolvedValue([]);

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhuma pasta')).toBeInTheDocument();
    });
  });

  it('renders "Nova pasta" button at the bottom', async () => {
    mockedGetTreeChildren.mockResolvedValue([]);

    render(
      <FolderTree selectedFolderId={null} onSelectFolder={vi.fn()} onRequestCreateFolder={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Nova pasta')).toBeInTheDocument();
    });
  });
});
