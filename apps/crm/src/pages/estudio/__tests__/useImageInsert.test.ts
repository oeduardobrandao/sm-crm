import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every async hook state update must be wrapped in `act` — same helper/pattern as
// useTextMeasurement.test.tsx / useSatoriRenderer.test.tsx.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const uploadEstudioImage = vi.fn();
vi.mock('../lib/uploadEstudioImage', () => ({
  uploadEstudioImage: (...args: unknown[]) => uploadEstudioImage(...args),
}));

const filesTableIn = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (column: string, ids: number[]) => filesTableIn(table, columns, column, ids),
      }),
    }),
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { useImageInsert } from '../hooks/useImageInsert';

function makeImageFile(name = 'photo.png', type = 'image/png'): File {
  return new File(['x'], name, { type });
}

function dataTransferWithFiles(files: File[], types: string[] = ['Files']): DataTransfer {
  return {
    files: files as unknown as FileList,
    types,
  } as unknown as DataTransfer;
}

function dragEvent(dataTransfer: DataTransfer, currentTarget: EventTarget = document.body) {
  return {
    dataTransfer,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget,
    relatedTarget: null,
  } as unknown as React.DragEvent;
}

describe('useImageInsert', () => {
  beforeEach(() => {
    uploadEstudioImage.mockReset();
    filesTableIn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('drag and drop', () => {
    it('uploads dropped image files and calls onInsert once with the full batch', async () => {
      uploadEstudioImage
        .mockResolvedValueOnce({ file_id: 1, width: 100, height: 100 })
        .mockResolvedValueOnce({ file_id: 2, width: 200, height: 200 });
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const files = [makeImageFile('a.png'), makeImageFile('b.png')];
      await act(async () => {
        result.current.dragDropProps.onDrop(dragEvent(dataTransferWithFiles(files)));
        await flush();
      });

      expect(uploadEstudioImage).toHaveBeenCalledTimes(2);
      expect(onInsert).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith([
        { file_id: 1, width: 100, height: 100 },
        { file_id: 2, width: 200, height: 200 },
      ]);
    });

    it('filters out non-image files from a drop, uploading only images', async () => {
      uploadEstudioImage.mockResolvedValueOnce({ file_id: 1, width: 50, height: 50 });
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const files = [
        makeImageFile('a.png'),
        new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
      ];
      await act(async () => {
        result.current.dragDropProps.onDrop(dragEvent(dataTransferWithFiles(files)));
        await flush();
      });

      expect(uploadEstudioImage).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith([{ file_id: 1, width: 50, height: 50 }]);
    });

    it('ignores an internal Arquivos drag (application/x-arquivos type) on dragover', () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const dt = dataTransferWithFiles([], ['application/x-arquivos']);
      const evt = dragEvent(dt);
      result.current.dragDropProps.onDragOver(evt);

      expect(evt.preventDefault).not.toHaveBeenCalled();
      expect(result.current.isDragOver).toBe(false);
    });

    it('ignores an internal Arquivos drag on drop (no upload triggered)', async () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const dt = dataTransferWithFiles([makeImageFile()], ['application/x-arquivos']);
      const evt = dragEvent(dt);
      await act(async () => {
        result.current.dragDropProps.onDrop(evt);
        await flush();
      });

      expect(evt.preventDefault).not.toHaveBeenCalled();
      expect(uploadEstudioImage).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });

    it('sets isDragOver true on dragover and false on drop', async () => {
      uploadEstudioImage.mockResolvedValue({ file_id: 1, width: 1, height: 1 });
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      act(() => {
        result.current.dragDropProps.onDragOver(dragEvent(dataTransferWithFiles([])));
      });
      expect(result.current.isDragOver).toBe(true);

      await act(async () => {
        result.current.dragDropProps.onDrop(dragEvent(dataTransferWithFiles([makeImageFile()])));
        await flush();
      });
      expect(result.current.isDragOver).toBe(false);
    });

    it('does not call onInsert when the drop has no image files', async () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      await act(async () => {
        result.current.dragDropProps.onDrop(dragEvent(dataTransferWithFiles([])));
        await flush();
      });

      expect(uploadEstudioImage).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });
  });

  describe('paste', () => {
    it('is inert while enabled is false (no listener attached)', async () => {
      uploadEstudioImage.mockResolvedValue({ file_id: 1, width: 1, height: 1 });
      const onInsert = vi.fn();
      renderHook(() => useImageInsert({ onInsert, enabled: false }));

      const evt = new Event('paste') as ClipboardEvent;
      Object.defineProperty(evt, 'clipboardData', {
        value: { files: [makeImageFile()] },
      });
      await act(async () => {
        window.dispatchEvent(evt);
        await flush();
      });

      expect(uploadEstudioImage).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });

    it('uploads pasted image files and calls onInsert once when enabled', async () => {
      uploadEstudioImage.mockResolvedValueOnce({ file_id: 9, width: 10, height: 20 });
      const onInsert = vi.fn();
      renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const evt = new Event('paste') as ClipboardEvent;
      Object.defineProperty(evt, 'clipboardData', {
        value: { files: [makeImageFile()] },
      });
      await act(async () => {
        window.dispatchEvent(evt);
        await flush();
      });

      expect(uploadEstudioImage).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith([{ file_id: 9, width: 10, height: 20 }]);
    });

    it('detaches the paste listener when enabled flips from true to false', async () => {
      uploadEstudioImage.mockResolvedValue({ file_id: 1, width: 1, height: 1 });
      const onInsert = vi.fn();
      const { rerender } = renderHook(({ enabled }) => useImageInsert({ onInsert, enabled }), {
        initialProps: { enabled: true },
      });

      rerender({ enabled: false });

      const evt = new Event('paste') as ClipboardEvent;
      Object.defineProperty(evt, 'clipboardData', {
        value: { files: [makeImageFile()] },
      });
      await act(async () => {
        window.dispatchEvent(evt);
        await flush();
      });

      expect(uploadEstudioImage).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });

    it('cleans up the listener on unmount', async () => {
      uploadEstudioImage.mockResolvedValue({ file_id: 1, width: 1, height: 1 });
      const onInsert = vi.fn();
      const { unmount } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      unmount();

      const evt = new Event('paste') as ClipboardEvent;
      Object.defineProperty(evt, 'clipboardData', {
        value: { files: [makeImageFile()] },
      });
      await act(async () => {
        window.dispatchEvent(evt);
        await flush();
      });

      expect(uploadEstudioImage).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });
  });

  describe('file dialog', () => {
    it('openFileDialog clicks the hidden input', () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const input = document.createElement('input');
      const clickSpy = vi.spyOn(input, 'click');
      // @ts-expect-error assigning a ref for the test
      result.current.fileInputRef.current = input;

      result.current.openFileDialog();
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('onFileInputChange uploads selected image files and calls onInsert once', async () => {
      uploadEstudioImage
        .mockResolvedValueOnce({ file_id: 1, width: 10, height: 10 })
        .mockResolvedValueOnce({ file_id: 2, width: 20, height: 20 });
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      const files = [makeImageFile('a.png'), makeImageFile('b.png')];
      const target = { files, value: 'x' } as unknown as HTMLInputElement;
      const evt = { target } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.onFileInputChange(evt);
      });

      expect(uploadEstudioImage).toHaveBeenCalledTimes(2);
      expect(onInsert).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith([
        { file_id: 1, width: 10, height: 10 },
        { file_id: 2, width: 20, height: 20 },
      ]);
      expect(target.value).toBe('');
    });
  });

  describe('Arquivos picker', () => {
    it('openArquivosPicker/closeArquivosPicker toggle isArquivosPickerOpen', () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      expect(result.current.isArquivosPickerOpen).toBe(false);
      act(() => result.current.openArquivosPicker());
      expect(result.current.isArquivosPickerOpen).toBe(true);
      act(() => result.current.closeArquivosPicker());
      expect(result.current.isArquivosPickerOpen).toBe(false);
    });

    it('onArquivosPickerSelect queries files table and calls onInsert once with resolved dimensions', async () => {
      filesTableIn.mockResolvedValue({
        data: [
          { id: 1, width: 300, height: 400 },
          { id: 2, width: null, height: null },
        ],
        error: null,
      });
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      await act(async () => {
        await result.current.onArquivosPickerSelect([1, 2]);
      });

      expect(filesTableIn).toHaveBeenCalledWith('files', 'id,width,height', 'id', [1, 2]);
      expect(onInsert).toHaveBeenCalledTimes(1);
      expect(onInsert).toHaveBeenCalledWith([
        { file_id: 1, width: 300, height: 400 },
        { file_id: 2, width: 800, height: 800 },
      ]);
    });

    it('does not query or call onInsert for an empty selection', async () => {
      const onInsert = vi.fn();
      const { result } = renderHook(() => useImageInsert({ onInsert, enabled: true }));

      await act(async () => {
        await result.current.onArquivosPickerSelect([]);
      });

      expect(filesTableIn).not.toHaveBeenCalled();
      expect(onInsert).not.toHaveBeenCalled();
    });
  });
});
