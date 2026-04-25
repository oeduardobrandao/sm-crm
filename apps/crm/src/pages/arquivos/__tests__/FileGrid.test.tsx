import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileGrid, formatBytes } from '../components/FileGrid';
import type { FileRecord, Folder } from '../types';

// Mock FileContextMenu to pass through children and right-click
vi.mock('../components/FileContextMenu', () => ({
  FileContextMenu: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));

// Mock tanstack/react-query so FileGrid can call useQueryClient without a provider
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    prefetchQuery: vi.fn(),
  }),
}));

// Mock fileService so the import in FileGrid doesn't require a real implementation
vi.mock('@/services/fileService', () => ({
  getFolderContents: vi.fn(),
}));

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    conta_id: 'conta-1',
    parent_id: null,
    name: 'Pasta Exemplo',
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
    size_bytes: 2048000,
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

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });
});

describe('FileGrid', () => {
  const defaultProps = {
    onOpenFolder: vi.fn(),
    onFileAction: vi.fn(),
    onActionComplete: vi.fn(),
    viewMode: 'grid' as const,
  };

  it('shows empty state when no files or folders', () => {
    render(
      <FileGrid
        files={[]}
        subfolders={[]}
        {...defaultProps}
      />,
    );

    expect(screen.getByText('Nenhum arquivo nesta pasta')).toBeInTheDocument();
  });

  describe('grid mode', () => {
    it('renders folder cards', () => {
      render(
        <FileGrid
          files={[]}
          subfolders={[
            makeFolder({ id: 1, name: 'Fotos' }),
            makeFolder({ id: 2, name: 'Videos' }),
          ]}
          {...defaultProps}
        />,
      );

      expect(screen.getByText('Fotos')).toBeInTheDocument();
      expect(screen.getByText('Videos')).toBeInTheDocument();
    });

    it('renders file cards with size info', () => {
      render(
        <FileGrid
          files={[
            makeFile({ id: 100, name: 'foto.jpg', size_bytes: 2048000 }),
            makeFile({ id: 101, name: 'video.mp4', kind: 'video', size_bytes: 15728640 }),
          ]}
          subfolders={[]}
          {...defaultProps}
        />,
      );

      expect(screen.getByText('foto.jpg')).toBeInTheDocument();
      expect(screen.getByText('video.mp4')).toBeInTheDocument();
      expect(screen.getByText('2.0 MB')).toBeInTheDocument();
      expect(screen.getByText('15.0 MB')).toBeInTheDocument();
    });

    it('clicking folder calls onOpenFolder', () => {
      const onOpenFolder = vi.fn();
      render(
        <FileGrid
          files={[]}
          subfolders={[makeFolder({ id: 5, name: 'Clientes' })]}
          {...defaultProps}
          onOpenFolder={onOpenFolder}
        />,
      );

      fireEvent.click(screen.getByText('Clientes'));
      expect(onOpenFolder).toHaveBeenCalledWith(5);
    });

    it('clicking file calls onFileAction with "open"', () => {
      const onFileAction = vi.fn();
      const file = makeFile({ id: 100, name: 'foto.jpg' });
      render(
        <FileGrid
          files={[file]}
          subfolders={[]}
          {...defaultProps}
          onFileAction={onFileAction}
        />,
      );

      fireEvent.click(screen.getByText('foto.jpg'));
      expect(onFileAction).toHaveBeenCalledWith('open', file);
    });

    it('shows thumbnail for images with url', () => {
      render(
        <FileGrid
          files={[
            makeFile({
              id: 100,
              name: 'foto.jpg',
              kind: 'image',
              url: 'https://cdn.example.com/foto.jpg',
              thumbnail_url: 'https://cdn.example.com/foto-thumb.jpg',
            }),
          ]}
          subfolders={[]}
          {...defaultProps}
        />,
      );

      const img = screen.getByAltText('foto.jpg');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/foto-thumb.jpg');
    });

    it('shows AUTO badge on system folders', () => {
      render(
        <FileGrid
          files={[]}
          subfolders={[makeFolder({ id: 1, name: 'Clientes', source: 'system' })]}
          {...defaultProps}
        />,
      );

      expect(screen.getByText('AUTO')).toBeInTheDocument();
    });

    it('shows reference count badge when file is linked', () => {
      render(
        <FileGrid
          files={[makeFile({ id: 100, name: 'foto.jpg', reference_count: 3 })]}
          subfolders={[]}
          {...defaultProps}
        />,
      );

      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('list mode', () => {
    it('renders table with folder and file rows', () => {
      render(
        <FileGrid
          files={[makeFile({ id: 100, name: 'doc.pdf', kind: 'document', size_bytes: 512000 })]}
          subfolders={[makeFolder({ id: 1, name: 'Relatórios' })]}
          {...defaultProps}
          viewMode="list"
        />,
      );

      // Table headers
      expect(screen.getByText('Nome')).toBeInTheDocument();
      expect(screen.getByText('Tipo')).toBeInTheDocument();
      expect(screen.getByText('Tamanho')).toBeInTheDocument();

      // Folder row
      expect(screen.getByText('Relatórios')).toBeInTheDocument();
      expect(screen.getByText('Pasta')).toBeInTheDocument();

      // File row
      expect(screen.getByText('doc.pdf')).toBeInTheDocument();
      expect(screen.getByText('Documento')).toBeInTheDocument();
      expect(screen.getByText('500 KB')).toBeInTheDocument();
    });

    it('shows correct kind labels in list view', () => {
      render(
        <FileGrid
          files={[
            makeFile({ id: 100, name: 'a.jpg', kind: 'image', size_bytes: 100 }),
            makeFile({ id: 101, name: 'b.mp4', kind: 'video', size_bytes: 200 }),
            makeFile({ id: 102, name: 'c.pdf', kind: 'document', size_bytes: 300 }),
          ]}
          subfolders={[]}
          {...defaultProps}
          viewMode="list"
        />,
      );

      expect(screen.getByText('Imagem')).toBeInTheDocument();
      expect(screen.getByText('Vídeo')).toBeInTheDocument();
      expect(screen.getByText('Documento')).toBeInTheDocument();
    });

    it('clicking folder row calls onOpenFolder', () => {
      const onOpenFolder = vi.fn();
      render(
        <FileGrid
          files={[]}
          subfolders={[makeFolder({ id: 7, name: 'Pastas' })]}
          {...defaultProps}
          onOpenFolder={onOpenFolder}
          viewMode="list"
        />,
      );

      fireEvent.click(screen.getByText('Pastas'));
      expect(onOpenFolder).toHaveBeenCalledWith(7);
    });

    it('clicking file row calls onFileAction', () => {
      const onFileAction = vi.fn();
      const file = makeFile({ id: 100, name: 'doc.pdf', kind: 'document' });
      render(
        <FileGrid
          files={[file]}
          subfolders={[]}
          {...defaultProps}
          onFileAction={onFileAction}
          viewMode="list"
        />,
      );

      fireEvent.click(screen.getByText('doc.pdf'));
      expect(onFileAction).toHaveBeenCalledWith('open', file);
    });
  });
});
