import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/fileService', () => ({
  uploadFile: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { uploadFile } from '@/services/fileService';
import { toast } from 'sonner';
import { FileUploader } from '../components/FileUploader';

const mockedUploadFile = vi.mocked(uploadFile);
const mockedToast = vi.mocked(toast);

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

function createTestFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024) {
  return new File(['file-contents'], name, { type });
}

describe('FileUploader', () => {
  const onUploadComplete = vi.fn();

  beforeEach(() => {
    onUploadComplete.mockReset();
    mockedUploadFile.mockReset();
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
  });

  it('renders children', () => {
    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={null} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div>Content inside uploader</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Content inside uploader')).toBeInTheDocument();
  });

  it('shows drag overlay text on drag over', () => {
    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={null} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div data-testid="drop-zone">Drop here</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    const dropZone = screen.getByText('Drop here').closest('[class*="relative"]')!;

    fireEvent.dragOver(dropZone, {
      dataTransfer: { files: [] },
    });

    expect(screen.getByText('Solte os arquivos aqui')).toBeInTheDocument();
  });

  it('hides drag overlay on drag leave', () => {
    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={null} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div>Content</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    const wrapper = screen.getByText('Content').closest('[class*="relative"]')!;

    fireEvent.dragOver(wrapper, { dataTransfer: { files: [] } });
    expect(screen.getByText('Solte os arquivos aqui')).toBeInTheDocument();

    fireEvent.dragLeave(wrapper, {
      dataTransfer: { files: [] },
      relatedTarget: document.body,
    });

    expect(screen.queryByText('Solte os arquivos aqui')).not.toBeInTheDocument();
  });

  it('dropping files triggers upload and shows success toast on completion', async () => {
    mockedUploadFile.mockResolvedValue({
      id: 1,
      conta_id: 'conta-1',
      folder_id: null,
      r2_key: 'files/photo.jpg',
      thumbnail_r2_key: null,
      name: 'photo.jpg',
      kind: 'image',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      width: 100,
      height: 100,
      duration_seconds: null,
      blur_data_url: null,
      uploaded_by: null,
      reference_count: 0,
      created_at: '2026-04-01T00:00:00Z',
    });

    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={5} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div>Content</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    const wrapper = screen.getByText('Content').closest('[class*="relative"]')!;
    const file = createTestFile('photo.jpg', 'image/jpeg');

    fireEvent.drop(wrapper, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(mockedUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          folderId: 5,
        }),
      );
    });

    await waitFor(() => {
      expect(mockedToast.success).toHaveBeenCalledWith('"photo.jpg" enviado com sucesso');
    });
    expect(onUploadComplete).toHaveBeenCalled();
  });

  it('shows error toast when upload fails', async () => {
    mockedUploadFile.mockRejectedValue(new Error('Upload failed'));

    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={null} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div>Content</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    const wrapper = screen.getByText('Content').closest('[class*="relative"]')!;
    const file = createTestFile('fail.jpg');

    fireEvent.drop(wrapper, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('Erro ao enviar "fail.jpg"');
    });
  });

  it('shows progress card during upload', async () => {
    // Create a promise that won't resolve immediately
    let resolveUpload!: (value: unknown) => void;
    mockedUploadFile.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );

    const triggerRef = createRef<{ openFilePicker: () => void }>();
    render(
      <FileUploader folderId={null} onUploadComplete={onUploadComplete} triggerRef={triggerRef}>
        <div>Content</div>
      </FileUploader>,
      { wrapper: createWrapper() },
    );

    const wrapper = screen.getByText('Content').closest('[class*="relative"]')!;
    const file = createTestFile('uploading.jpg');

    fireEvent.drop(wrapper, {
      dataTransfer: { files: [file] },
    });

    // The progress card should appear with the file name
    await waitFor(() => {
      expect(screen.getByText('Enviando...')).toBeInTheDocument();
    });

    // Resolve the upload
    resolveUpload({
      id: 1,
      conta_id: 'conta-1',
      folder_id: null,
      r2_key: 'files/uploading.jpg',
      thumbnail_r2_key: null,
      name: 'uploading.jpg',
      kind: 'image',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      width: 100,
      height: 100,
      duration_seconds: null,
      blur_data_url: null,
      uploaded_by: null,
      reference_count: 0,
      created_at: '2026-04-01T00:00:00Z',
    });

    await waitFor(() => {
      expect(screen.getByText('Concluído')).toBeInTheDocument();
    });
  });
});
