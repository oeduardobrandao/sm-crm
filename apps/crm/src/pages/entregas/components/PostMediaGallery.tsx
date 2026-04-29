import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { Upload, Star, Trash2, AlertTriangle, Download, FolderOpen } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, rectSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  listPostMedia, uploadPostMedia, deletePostMedia, setPostMediaCover,
  reorderPostMedia, detectKind,
} from '../../../services/postMedia';
import type { PostMedia } from '../../../store';
import { OptimizedImage } from '../../../components/OptimizedImage';
import { PostMediaLightbox } from './PostMediaLightbox';
import { FilePickerModal } from '../../arquivos/components/FilePickerModal';
import { linkFileToPost, unlinkFileFromPost } from '../../../services/fileService';

interface PostMediaGalleryProps {
  postId: number;
  disabled?: boolean;
  maxFiles?: number;
  onChange?: (media: PostMedia[]) => void;
}

export function PostMediaGallery({ postId, disabled, maxFiles, onChange }: PostMediaGalleryProps) {
  const qc = useQueryClient();
  const { data: serverMedia, isLoading: mediaLoading } = useQuery({
    queryKey: ['post-media', postId],
    queryFn: () => listPostMedia(postId),
    staleTime: 5 * 60 * 1000,
  });

  // Local ordered copy so drag-reorder feels instant and doesn't flash back
  // while the PATCH round-trips and the query refetches. Sync only when the
  // query produces a new defined value — destructuring with a `[]` default
  // would create a fresh reference each render and loop the effect.
  const [media, setMedia] = useState<PostMedia[]>([]);
  useEffect(() => { if (serverMedia) setMedia(serverMedia); }, [serverMedia]);

  // Stash onChange in a ref so an unmemoized parent callback can't loop us.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { onChangeRef.current?.(media); }, [media]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = media.findIndex((m) => m.id === active.id);
    const newIndex = media.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(media, oldIndex, newIndex);
    setMedia(next);
    try {
      await Promise.all(next.map((m, i) => reorderPostMedia(m.id, i)));
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
      // Re-sync from server instead of reverting to a captured snapshot,
      // which could be stale if a background refetch landed mid-drag.
      refresh();
    }
  }

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<Map<string, { name: string; pct: number; status: 'uploading' | 'done' | 'error' }>>(new Map());
  const [dragOver, setDragOver] = useState(false);

  // Preload images into browser cache so lightbox opens instantly.
  const preloadCache = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    preloadCache.current = media
      .filter((m) => m.kind === 'image' && m.url)
      .map((m) => {
        const img = new Image();
        img.src = m.url!;
        return img;
      });
  }, [media]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['post-media', postId] });
  const atLimit = maxFiles != null && media.length >= maxFiles;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    const images: File[] = [];
    for (const file of fileArr) {
      if (detectKind(file) === 'video') {
        setPendingVideo(file);
        return;
      }
      images.push(file);
    }
    if (images.length === 0) return;

    setUploading(true);
    const ids = images.map((_, i) => `upload-${Date.now()}-${i}`);
    setUploadQueue(prev => {
      const next = new Map(prev);
      images.forEach((f, i) => next.set(ids[i], { name: f.name, pct: 0, status: 'uploading' }));
      return next;
    });

    let hasError = false;
    await Promise.all(
      images.map(async (file, i) => {
        const uid = ids[i];
        try {
          await uploadPostMedia({
            postId,
            file,
            onProgress: (p) => setUploadQueue(prev => {
              const next = new Map(prev);
              next.set(uid, { name: file.name, pct: Math.round((p.loaded / p.total) * 100), status: 'uploading' });
              return next;
            }),
          });
          setUploadQueue(prev => {
            const next = new Map(prev);
            next.set(uid, { name: file.name, pct: 100, status: 'done' });
            return next;
          });
        } catch (e) {
          hasError = true;
          toast.error(`${file.name}: ${(e as Error).message}`);
          setUploadQueue(prev => {
            const next = new Map(prev);
            next.set(uid, { name: file.name, pct: 0, status: 'error' });
            return next;
          });
        }
      })
    );

    refresh();
    if (!hasError) toast.success('Upload concluído');
    setUploading(false);
    setTimeout(() => setUploadQueue(new Map()), 2000);
  }

  async function handleVideoThumbnail(thumbnail: File) {
    if (!pendingVideo) return;
    setUploading(true);
    const uid = `upload-video-${Date.now()}`;
    setUploadQueue(prev => {
      const next = new Map(prev);
      next.set(uid, { name: pendingVideo.name, pct: 0, status: 'uploading' });
      return next;
    });
    try {
      await uploadPostMedia({
        postId,
        file: pendingVideo,
        thumbnail,
        onProgress: (p) => setUploadQueue(prev => {
          const next = new Map(prev);
          next.set(uid, { name: pendingVideo.name, pct: Math.round((p.loaded / p.total) * 100), status: 'uploading' });
          return next;
        }),
      });
      setUploadQueue(prev => {
        const next = new Map(prev);
        next.set(uid, { name: pendingVideo.name, pct: 100, status: 'done' });
        return next;
      });
      setPendingVideo(null);
      refresh();
      toast.success('Vídeo enviado');
    } catch (e) {
      toast.error((e as Error).message);
      setUploadQueue(prev => {
        const next = new Map(prev);
        next.set(uid, { name: pendingVideo.name, pct: 0, status: 'error' });
        return next;
      });
    } finally {
      setUploading(false);
      setTimeout(() => setUploadQueue(new Map()), 2000);
    }
  }

  async function handleDownloadAll() {
    if (media.length === 0) return;
    setDownloading(true);
    try {
      const entries = await Promise.all(
        media
          .filter((m) => m.url)
          .map(async (m) => {
            const res = await fetch(m.url!);
            const blob = await res.blob();
            return { filename: m.original_filename, blob };
          }),
      );

      const zip = new JSZip();
      const seen = new Map<string, number>();
      for (const { filename: rawName, blob } of entries) {
        let filename = rawName;
        const count = seen.get(rawName) ?? 0;
        if (count > 0) {
          const dotIdx = filename.lastIndexOf('.');
          filename = dotIdx > 0
            ? `${filename.slice(0, dotIdx)} (${count})${filename.slice(dotIdx)}`
            : `${filename} (${count})`;
        }
        seen.set(rawName, count + 1);
        zip.file(filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const objUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `media-${postId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toast.success('Download concluído');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(id: number) {
    try { await deletePostMedia(id); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handleSetCover(id: number) {
    try { await setPostMediaCover(id); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handlePickFiles(fileIds: number[]) {
    try {
      await Promise.all(fileIds.map((fileId) => linkFileToPost(fileId, postId)));
      refresh();
      toast.success(`${fileIds.length} arquivo(s) vinculado(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (mediaLoading) {
    return (
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
        {[1, 0.5, 0.2].map((opacity, i) => (
          <div key={i} className="aspect-square rounded-xl bg-stone-100 dark:bg-stone-800 animate-pulse" style={{ opacity }} />
        ))}
      </div>
    );
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || atLimit) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFiles(files);
  };

  const handleDragOverEvent = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !atLimit) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={media.map((m) => m.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {media.map((m, i) => (
              <SortableMediaTile
                key={m.id}
                media={m}
                disabled={disabled}
                onOpen={() => setLightboxIndex(i)}
                onSetCover={() => handleSetCover(m.id)}
                onDelete={() => handleDelete(m.id)}
              />
            ))}
            {!disabled && !atLimit && (
              <label
                onDrop={handleDrop}
                onDragOver={handleDragOverEvent}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed cursor-pointer transition-colors ${dragOver ? 'ring-2 ring-[#eab308] border-[#eab308] bg-[#eab308]/10 text-[#eab308]' : 'border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700'}`}
              >
                <Upload className="h-4 w-4" />
                <span className="text-[11px]">{dragOver ? 'Soltar aqui' : uploading ? 'Enviando…' : 'Adicionar'}</span>
                <input type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
              </label>
            )}
            {!disabled && !atLimit && (
              <button
                type="button"
                onClick={() => setShowFilePicker(true)}
                className="flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700 cursor-pointer transition-colors"
              >
                <FolderOpen className="h-4 w-4" />
                <span className="text-[11px]">Escolher</span>
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {media.length > 0 && (
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 dark:text-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {downloading ? 'Baixando…' : 'Baixar todos'}
        </button>
      )}

      {uploadQueue.size > 0 && (
        <div className="space-y-1.5">
          {[...uploadQueue.entries()].map(([uid, item]) => (
            <div key={uid} className="rounded-xl bg-stone-50 ring-1 ring-stone-200/80 px-3 py-2">
              <div className="flex items-center justify-between text-[11.5px] text-stone-600 mb-1">
                <span className="truncate pr-2">{item.name}</span>
                <span className="tabular-nums font-medium text-stone-900">
                  {item.status === 'done' ? '✓' : item.status === 'error' ? 'Erro' : `${item.pct}%`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className={`h-full transition-all ${item.status === 'error' ? 'bg-red-500' : item.status === 'done' ? 'bg-emerald-500' : 'bg-stone-900'}`}
                  style={{ width: `${item.status === 'error' ? 100 : item.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingVideo && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200/60 px-3 py-2 text-[12.5px] text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Selecione uma thumbnail para o vídeo <strong>{pendingVideo.name}</strong></span>
          <label className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 text-white text-[11px] font-semibold cursor-pointer hover:bg-stone-700">
            Escolher thumbnail
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoThumbnail(f); }} />
          </label>
          <button
            type="button"
            onClick={() => setPendingVideo(null)}
            className="text-[11px] text-stone-500 hover:text-stone-700"
          >
            Cancelar
          </button>
        </div>
      )}

      <PostMediaLightbox
        media={media}
        initialIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onOpenChange={(o) => { if (!o) setLightboxIndex(null); }}
        onDownloadAll={handleDownloadAll}
      />

      <FilePickerModal
        open={showFilePicker}
        onClose={() => setShowFilePicker(false)}
        onSelect={handlePickFiles}
        filterKind={['image', 'video']}
      />
    </div>
  );
}

interface SortableMediaTileProps {
  media: PostMedia;
  disabled?: boolean;
  onOpen: () => void;
  onSetCover: () => void;
  onDelete: () => void;
}

function SortableMediaTile({ media: m, disabled, onOpen, onSetCover, onDelete }: SortableMediaTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: m.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200/80 group cursor-grab active:cursor-grabbing touch-none"
    >
      {m.kind === 'image' ? (
        <OptimizedImage
          src={m.url ?? ''}
          alt={m.original_filename}
          width={m.width ?? undefined}
          height={m.height ?? undefined}
          blurDataURL={m.blur_data_url ?? undefined}
          className="w-full h-full object-cover pointer-events-none"
        />
      ) : (
        <video src={m.url ?? undefined} poster={m.thumbnail_url ?? undefined} muted className="w-full h-full object-cover pointer-events-none" />
      )}
      {m.is_cover && (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] font-semibold bg-stone-900/85 text-white px-1.5 py-0.5 rounded-full">
          <Star className="h-2.5 w-2.5" /> capa
        </span>
      )}
      {!disabled && (
        <div
          className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!m.is_cover && (
            <button
              type="button"
              onClick={onSetCover}
              title="Definir como capa"
              className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-stone-900"
            >
              <Star className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            title="Remover"
            className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-rose-600"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// Exported helper so WorkflowDrawer can gate the "send to client" button.
export function hasVideoMissingThumbnail(media: PostMedia[]): boolean {
  return media.some((m) => m.kind === 'video' && !m.thumbnail_r2_key);
}
