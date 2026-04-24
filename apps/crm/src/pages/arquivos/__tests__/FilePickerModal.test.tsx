import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  getFolderContents: vi.fn(),
}));

import { getFolderContents } from '@/services/fileService';
import { FilePickerModal } from '../components/FilePickerModal';
import type { FileRecord, Folder, FolderContents } from '../types';

const mockedGetFolderContents = vi.mocked(getFolderContents);

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Pasta',
    source: 'user',
    source_type: null,
    source_id: null,
    name_overridden: false,
    position: 0,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 100,
    conta_id: 'conta-1',
    folder_id: 1,
    r2_key: 'files/foto.jpg',
    thumbnail_r2_key: null,
    name: 'foto.jpg',
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    blur_data_url: null,
    uploaded_by: null,
    reference_count: 0,
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeFolderContents(overrides: Partial<FolderContents> = {}): FolderContents {
  return {
    folder: null,
    subfolders: [],
    files: [],
    breadcrumbs: [],
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

describe('FilePickerModal', () => {
  beforeEach(() => {
    mockedGetFolderContents.mockReset();
  });

  it('shows dialog with title when open', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Selecionar arquivos')).toBeInTheDocument();
    });
  });

  it('does not render dialog content when closed', () => {
    render(
      <FilePickerModal open={false} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.queryByText('Selecionar arquivos')).not.toBeInTheDocument();
  });

  it('shows folders and files', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        subfolders: [makeFolder({ id: 1, name: 'Fotos' })],
        files: [
          makeFile({ id: 100, name: 'image1.jpg' }),
          makeFile({ id: 101, name: 'image2.jpg' }),
        ],
      }),
    );

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Fotos')).toBeInTheDocument();
    });
    expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    expect(screen.getByText('image2.jpg')).toBeInTheDocument();
  });

  it('shows empty state when no files or folders', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhum arquivo encontrado')).toBeInTheDocument();
    });
  });

  it('selecting files toggles selection and updates footer count', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [
          makeFile({ id: 100, name: 'a.jpg' }),
          makeFile({ id: 101, name: 'b.jpg' }),
        ],
      }),
    );

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('a.jpg')).toBeInTheDocument();
    });

    expect(screen.getByText('Nenhum arquivo selecionado')).toBeInTheDocument();

    // Select first file
    fireEvent.click(screen.getByText('a.jpg'));
    expect(screen.getByText('1 arquivo selecionado')).toBeInTheDocument();

    // Select second file
    fireEvent.click(screen.getByText('b.jpg'));
    expect(screen.getByText('2 arquivos selecionados')).toBeInTheDocument();

    // Deselect first file
    fireEvent.click(screen.getByText('a.jpg'));
    expect(screen.getByText('1 arquivo selecionado')).toBeInTheDocument();
  });

  it('Vincular button is disabled when no files are selected', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [makeFile({ id: 100, name: 'test.jpg' })],
      }),
    );

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('test.jpg')).toBeInTheDocument();
    });

    expect(screen.getByText('Vincular')).toBeDisabled();
  });

  it('Vincular button calls onSelect with selected file IDs and closes', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [
          makeFile({ id: 100, name: 'a.jpg' }),
          makeFile({ id: 101, name: 'b.jpg' }),
        ],
      }),
    );

    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <FilePickerModal open={true} onClose={onClose} onSelect={onSelect} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('a.jpg')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('a.jpg'));
    fireEvent.click(screen.getByText('b.jpg'));
    fireEvent.click(screen.getByText('Vincular'));

    expect(onSelect).toHaveBeenCalledWith(expect.arrayContaining([100, 101]));
    expect(onClose).toHaveBeenCalled();
  });

  it('search filters files by name', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [
          makeFile({ id: 100, name: 'banner-principal.jpg' }),
          makeFile({ id: 101, name: 'logo-marca.png' }),
        ],
      }),
    );

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('banner-principal.jpg')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Buscar...');
    fireEvent.change(searchInput, { target: { value: 'logo' } });

    expect(screen.queryByText('banner-principal.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('logo-marca.png')).toBeInTheDocument();
  });

  it('filterKind limits file types shown', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [
          makeFile({ id: 100, name: 'photo.jpg', kind: 'image' }),
          makeFile({ id: 101, name: 'video.mp4', kind: 'video' }),
          makeFile({ id: 102, name: 'report.pdf', kind: 'document' }),
        ],
      }),
    );

    render(
      <FilePickerModal
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        filterKind={['image']}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });

    expect(screen.queryByText('video.mp4')).not.toBeInTheDocument();
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument();
  });

  it('navigates into a folder when clicking it', async () => {
    // Root contents
    mockedGetFolderContents.mockResolvedValueOnce(
      makeFolderContents({
        subfolders: [makeFolder({ id: 5, name: 'Fotos' })],
        files: [],
      }),
    );

    // Contents of folder 5
    mockedGetFolderContents.mockResolvedValueOnce(
      makeFolderContents({
        folder: makeFolder({ id: 5, name: 'Fotos' }),
        subfolders: [],
        files: [makeFile({ id: 200, name: 'inside.jpg' })],
        breadcrumbs: [{ id: 5, name: 'Fotos' }],
      }),
    );

    render(
      <FilePickerModal open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Fotos')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Fotos'));

    await waitFor(() => {
      expect(screen.getByText('inside.jpg')).toBeInTheDocument();
    });
  });

  it('Cancelar button calls onClose', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    const onClose = vi.fn();
    render(
      <FilePickerModal open={true} onClose={onClose} onSelect={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText('Cancelar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });
});
