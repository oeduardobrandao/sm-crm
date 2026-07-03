// T2.9 (docs/estudio-plan.md lines 141-158): unifies all four image-insert paths the
// design calls for — hidden-input file dialog, drag-and-drop, window-level paste, and the
// Arquivos picker modal — behind one `onInsert(files)` callback fired ONCE per batch (not
// once per file), so callers (LeftToolDock) only need one place to turn uploaded/picked
// files into layers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadEstudioImage, type UploadedEstudioImage } from '../lib/uploadEstudioImage';

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

// Fallback used when a `files` row's width/height come back null — mirrors
// uploadEstudioImage.ts's own fallback so every insert path yields consistent dimensions.
const FALLBACK_IMAGE_DIMENSION = 800;

function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.includes(file.type);
}

/** Internal-drag guard shared with apps/crm/src/pages/arquivos/components/FileUploader.tsx's
 * exact hand-rolled pattern — ignores drags originating from the app's own Arquivos tree
 * (identified by this custom MIME type) so they don't get misread as external file drops. */
function isInternalDrag(dataTransfer: DataTransfer | null): boolean {
  const types: readonly string[] = dataTransfer?.types ?? [];
  return Array.from(types).includes('application/x-arquivos');
}

async function uploadMany(files: File[]): Promise<UploadedEstudioImage[]> {
  const results: UploadedEstudioImage[] = [];
  for (const file of files) {
    try {
      results.push(await uploadEstudioImage(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar a imagem.');
    }
  }
  return results;
}

export interface UseImageInsertOptions {
  onInsert: (files: UploadedEstudioImage[]) => void;
  /** Gates the window-level paste listener. The caller passes `false` while some other part
   * of the editor (e.g. a text layer being edited) owns paste — this hook doesn't need to
   * know why, it just doesn't attach the listener while disabled. */
  enabled: boolean;
}

export interface UseImageInsertResult {
  openFileDialog: () => void;
  dragDropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  isDragOver: boolean;
  isArquivosPickerOpen: boolean;
  openArquivosPicker: () => void;
  closeArquivosPicker: () => void;
  onArquivosPickerSelect: (fileIds: number[]) => void;
  /** Ref to spread onto a hidden `<input type="file" accept="image/*" multiple>` rendered by
   * the caller (kept here rather than portal'd so callers control where it mounts). */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useImageInsert(opts: UseImageInsertOptions): UseImageInsertResult {
  const { onInsert, enabled } = opts;
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isArquivosPickerOpen, setIsArquivosPickerOpen] = useState(false);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isImageFile);
    e.target.value = ''; // allow re-selecting the same file
    if (files.length === 0) return;
    const results = await uploadMany(files);
    if (results.length > 0) onInsertRef.current(results);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (isInternalDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (isInternalDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files ?? []).filter(isImageFile);
    if (files.length === 0) return;
    void uploadMany(files).then((results) => {
      if (results.length > 0) onInsertRef.current(results);
    });
  }, []);

  const openArquivosPicker = useCallback(() => setIsArquivosPickerOpen(true), []);
  const closeArquivosPicker = useCallback(() => setIsArquivosPickerOpen(false), []);

  const onArquivosPickerSelect = useCallback((fileIds: number[]) => {
    if (fileIds.length === 0) return;
    void (async () => {
      const { data, error } = await supabase
        .from('files')
        .select('id,width,height')
        .in('id', fileIds);
      if (error) {
        toast.error('Não foi possível carregar os arquivos selecionados.');
        return;
      }
      const results: UploadedEstudioImage[] = (data ?? []).map((row) => ({
        file_id: row.id,
        width: row.width ?? FALLBACK_IMAGE_DIMENSION,
        height: row.height ?? FALLBACK_IMAGE_DIMENSION,
      }));
      if (results.length > 0) onInsertRef.current(results);
    })();
  }, []);

  // Window-level paste — active ONLY while `enabled`. Gated purely on the boolean; this hook
  // doesn't need to know why the caller disabled it (e.g. a text layer editing session
  // elsewhere owns paste at that moment).
  useEffect(() => {
    if (!enabled) return;

    function handlePaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
      if (files.length === 0) return;
      void uploadMany(files).then((results) => {
        if (results.length > 0) onInsertRef.current(results);
      });
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [enabled]);

  return {
    openFileDialog,
    dragDropProps: { onDragOver, onDragLeave, onDrop },
    isDragOver,
    isArquivosPickerOpen,
    openArquivosPicker,
    closeArquivosPicker,
    onArquivosPickerSelect,
    fileInputRef,
    onFileInputChange,
  };
}
