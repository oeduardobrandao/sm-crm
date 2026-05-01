import {
  useRef,
  useState,
  useImperativeHandle,
  useCallback,
  type DragEvent,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { uploadFile } from '@/services/fileService';

// ─── Types ────────────────────────────────────────────────────────

type UploadStatus = 'uploading' | 'complete' | 'error';

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: UploadStatus;
}

export interface FileUploaderProps {
  folderId: number | null;
  onUploadComplete: () => void;
  children: React.ReactNode;
  triggerRef: React.RefObject<{ openFilePicker: () => void } | null>;
}

// ─── Video thumbnail helper ────────────────────────────────────────

function captureVideoThumbnail(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const MAX_THUMB_WIDTH = 400;
      const scale = video.videoWidth > MAX_THUMB_WIDTH ? MAX_THUMB_WIDTH / video.videoWidth : 1;
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error('Failed to capture thumbnail'));
          resolve(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.8,
      );
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Video load error'));
    };
    video.src = url;
  });
}

// ─── Component ────────────────────────────────────────────────────

export function FileUploader({
  folderId,
  onUploadComplete,
  children,
  triggerRef,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);

  const activeUploads = useRef(0);
  const pendingQueue = useRef<{ file: File; itemId: string }[]>([]);
  const MAX_CONCURRENT = 3;

  // Expose openFilePicker via triggerRef
  useImperativeHandle(triggerRef, () => ({
    openFilePicker: () => inputRef.current?.click(),
  }));

  const mutation = useMutation({
    mutationFn: async ({
      file,
      itemId,
    }: {
      file: File;
      itemId: string;
    }) => {
      // Generate thumbnail for videos
      let thumbnail: File | undefined;
      if (file.type.startsWith('video/')) {
        thumbnail = await captureVideoThumbnail(file).catch(() => undefined);
      }

      return uploadFile({
        file,
        folderId,
        thumbnail,
        onProgress: ({ loaded, total }) => {
          const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setQueue((prev) =>
            prev.map((item) =>
              item.id === itemId ? { ...item, progress } : item,
            ),
          );
        },
      });
    },
    onSuccess: (_data, { itemId, file }) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, status: 'complete', progress: 100 } : item,
        ),
      );
      toast.success(`"${file.name}" enviado com sucesso`);
      onUploadComplete();

      // Auto-dismiss after 3 seconds
      setTimeout(() => {
        setQueue((prev) => prev.filter((item) => item.id !== itemId));
      }, 3000);
    },
    onError: (_err, { itemId, file }) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, status: 'error' } : item,
        ),
      );
      toast.error(`Erro ao enviar "${file.name}"`);

      // Auto-dismiss errors after 5 seconds
      setTimeout(() => {
        setQueue((prev) => prev.filter((item) => item.id !== itemId));
      }, 5000);
    },
  });

  const startUpload = useCallback(
    (file: File, itemId: string) => {
      activeUploads.current++;
      mutation.mutate(
        { file, itemId },
        {
          onSettled: () => {
            activeUploads.current--;
            const next = pendingQueue.current.shift();
            if (next) startUpload(next.file, next.itemId);
          },
        },
      );
    },
    [mutation],
  );

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) => f.type !== '');

      for (const file of fileArray) {
        const itemId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        setQueue((prev) => [
          ...prev,
          { id: itemId, name: file.name, progress: 0, status: 'uploading' },
        ]);

        if (activeUploads.current < MAX_CONCURRENT) {
          startUpload(file, itemId);
        } else {
          pendingQueue.current.push({ file, itemId });
        }
      }
    },
    [startUpload],
  );

  // ─── File input change ─────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      processFiles(e.target.files);
      // Reset so same file can be re-selected
      e.target.value = '';
    }
  }

  // ─── Drag and drop ─────────────────────────────────────────────
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    // Only activate for external file drops, not internal move drags
    const types: readonly string[] | string[] = e.dataTransfer.types ?? [];
    if (Array.from(types).includes('application/x-arquivos')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving the wrapper entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    // Ignore internal move drags
    const types: readonly string[] | string[] = e.dataTransfer.types ?? [];
    if (Array.from(types).includes('application/x-arquivos')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length) {
      processFiles(files);
    }
  }

  const hasQueue = queue.length > 0;

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Drag-and-drop wrapper */}
      <div
        className="relative flex-1 flex flex-col min-h-0"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {children}

        {/* Drag overlay */}
        {isDragOver && (
          <div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-xl pointer-events-none"
            style={{
              background: 'color-mix(in srgb, var(--primary-color) 8%, transparent)',
              border: '2.5px dashed var(--primary-color)',
            }}
          >
            <p
              className="text-lg font-semibold"
              style={{ color: 'var(--primary-color)' }}
            >
              Solte os arquivos aqui
            </p>
          </div>
        )}
      </div>

      {/* Floating upload progress panel */}
      {hasQueue && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col gap-2"
          style={{ width: 320 }}
        >
          {queue.map((item) => (
            <UploadProgressCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

// ─── Individual progress card ──────────────────────────────────────

function UploadProgressCard({ item }: { item: UploadItem }) {
  const truncated =
    item.name.length > 36 ? `${item.name.slice(0, 33)}...` : item.name;

  return (
    <div
      className="rounded-xl px-4 py-3 shadow-lg flex flex-col gap-2"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-sm font-medium truncate"
          style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}
          title={item.name}
        >
          {truncated}
        </span>

        <span className="flex-shrink-0">
          {item.status === 'uploading' && (
            <Loader2
              className="h-4 w-4 animate-spin"
              style={{ color: 'var(--primary-color)' }}
            />
          )}
          {item.status === 'complete' && (
            <CheckCircle className="h-4 w-4 text-[#3ecf8e]" />
          )}
          {item.status === 'error' && (
            <XCircle className="h-4 w-4 text-[#f55a42]" />
          )}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 4, background: 'var(--border-color)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${item.progress}%`,
            background:
              item.status === 'error'
                ? 'var(--danger, #f55a42)'
                : 'var(--primary-color)',
          }}
        />
      </div>

      {/* Status text */}
      <div className="flex justify-between items-center">
        <span
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {item.status === 'uploading' && 'Enviando...'}
          {item.status === 'complete' && 'Concluído'}
          {item.status === 'error' && 'Erro no envio'}
        </span>
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {item.status === 'error' ? '' : `${item.progress}%`}
        </span>
      </div>
    </div>
  );
}
