import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

vi.mock('@/services/fileService', () => ({
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

import { getFolderContents, createFolder } from '@/services/fileService';
import { toast } from 'sonner';
import type { FolderContents, Folder, FileRecord } from '../types';

const mockedGetFolderContents = vi.mocked(getFolderContents);
const mockedCreateFolder = vi.mocked(createFolder);
const mockedToast = vi.mocked(toast);

// Import the page component after mocks
import ArquivosPage from '../ArquivosPage';

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
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ArquivosPage', () => {
  beforeEach(() => {
    mockedGetFolderContents.mockReset();
    mockedCreateFolder.mockReset();
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'owner' })) });
  });

  it('renders sidebar with FolderTree and heading', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    expect(screen.getByText('Arquivos')).toBeInTheDocument();
  });

  it('renders Upload and Nova pasta buttons in toolbar', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    expect(screen.getByText('Enviar arquivo')).toBeInTheDocument();
    // There may be multiple "Nova pasta" (one in tree, one in toolbar)
    const novaPastaButtons = screen.getAllByText('Nova pasta');
    expect(novaPastaButtons.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Task 14: ArquivosPage had NO role check at all before this task -- any
   * authenticated member could upload, create folders, and bulk-delete.
   * `AGENT_ROLE_PRESET.arquivos` is 'editar' (lib/permissions.ts), so gating
   * the toolbar's "Enviar arquivo" button on `can('arquivos', 'editar') ===
   * true` preserves that for every legacy chassis role byte-for-byte; only a
   * CUSTOM role (role_id set) can now differ from full access.
   */
  it('hides the toolbar Enviar arquivo button for a custom role without arquivos:editar', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    expect(screen.queryByText('Enviar arquivo')).not.toBeInTheDocument();
  });

  it('shows the toolbar Enviar arquivo button for a custom role with arquivos:editar (the fix)', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { arquivos: 'editar' } }),
      ),
    });
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    expect(screen.getByText('Enviar arquivo')).toBeInTheDocument();
  });

  it('renders view mode toggle buttons', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    expect(screen.getByLabelText('Grade')).toBeInTheDocument();
    expect(screen.getByLabelText('Lista')).toBeInTheDocument();
  });

  it('shows content after loading', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        subfolders: [makeFolder({ id: 1, name: 'Pasta Root' })],
        files: [makeFile({ id: 100, name: 'banner.jpg' })],
      }),
    );

    render(<ArquivosPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      // FileGrid should show the folder in the main area
      expect(screen.getAllByText('Pasta Root').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('banner.jpg')).toBeInTheDocument();
  });

  it('toggles between grid and list view modes', async () => {
    mockedGetFolderContents.mockResolvedValue(
      makeFolderContents({
        files: [makeFile({ id: 100, name: 'doc.pdf', kind: 'document', size_bytes: 512000 })],
      }),
    );

    render(<ArquivosPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    });

    // Switch to list view
    fireEvent.click(screen.getByLabelText('Lista'));

    // In list view we should see table headers
    await waitFor(() => {
      // "Nome" appears both in the sort dropdown and the table header
      expect(screen.getAllByText('Nome').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('Tipo')).toBeInTheDocument();
    // "Tamanho" appears both in the sort dropdown and the table header
    expect(screen.getAllByText('Tamanho').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Documento')).toBeInTheDocument();

    // Switch back to grid view
    fireEvent.click(screen.getByLabelText('Grade'));

    await waitFor(() => {
      // Table header "Tamanho" should disappear in grid mode, but sort dropdown "Tamanho" remains
      expect(screen.getAllByText('Tamanho').length).toBe(1);
    });
  });

  it('renders breadcrumbs with "Todos os Arquivos"', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      // The breadcrumb root link
      expect(screen.getByText('Todos os Arquivos')).toBeInTheDocument();
    });
  });

  it('shows empty state when folder has no content', async () => {
    mockedGetFolderContents.mockResolvedValue(makeFolderContents());

    render(<ArquivosPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Nenhum arquivo nesta pasta')).toBeInTheDocument();
    });
  });

  describe('lightbox playback mapping', () => {
    // Stubbing canPlayType('probably') keeps the HLS-bearing case on the
    // synchronous native-HLS path in VideoPlayer, mirroring the pattern in
    // entregas/hub's PostMediaLightbox tests and VideoPlayer's own tests.
    afterEach(() => {
      delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
    });

    it('carries the playback field from FileRecord into the lightbox video element', async () => {
      HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
        type: string,
      ) => CanPlayTypeResult;

      mockedGetFolderContents.mockResolvedValue(
        makeFolderContents({
          files: [
            makeFile({
              id: 200,
              name: 'clip.mp4',
              kind: 'video',
              mime_type: 'video/mp4',
              url: 'https://media.test/clip.mp4',
              playback: {
                hls: 'https://videodelivery.example.com/uid123/manifest/video.m3u8',
                expires_at: '2026-08-13T12:00:00Z',
              },
            }),
          ],
        }),
      );

      render(<ArquivosPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('clip.mp4')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('clip.mp4'));

      await waitFor(() => {
        const video = document.body.querySelector('video');
        expect(video).toHaveAttribute(
          'src',
          'https://videodelivery.example.com/uid123/manifest/video.m3u8',
        );
      });
    });
  });

  describe('lightbox media_lost_at mapping', () => {
    it('carries the media_lost_at field from FileRecord into the lightbox, showing the unavailable placeholder', async () => {
      mockedGetFolderContents.mockResolvedValue(
        makeFolderContents({
          files: [
            makeFile({
              id: 200,
              name: 'perdido.png',
              kind: 'image',
              url: undefined,
              thumbnail_url: null,
              media_lost_at: '2026-08-14T03:00:00.000Z',
            }),
          ],
        }),
      );

      render(<ArquivosPage />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText('perdido.png')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('perdido.png'));

      await waitFor(() => {
        expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
      });
    });
  });
});
