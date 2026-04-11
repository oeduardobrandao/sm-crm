import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Star, Trash2, AlertTriangle } from 'lucide-react';
import {
  listPostMedia, uploadPostMedia, deletePostMedia, setPostMediaCover,
  detectKind,
} from '../../../services/postMedia';
import type { PostMedia } from '../../../store';

interface PostMediaGalleryProps {
  postId: number;
  disabled?: boolean;
  onChange?: (media: PostMedia[]) => void;
}

export function PostMediaGallery({ postId, disabled, onChange }: PostMediaGalleryProps) {
  const qc = useQueryClient();
  const { data: media = [] } = useQuery({
    queryKey: ['post-media', postId],
    queryFn: () => listPostMedia(postId),
  });

  useEffect(() => { onChange?.(media); }, [media, onChange]);

  const [uploading, setUploading] = useState(false);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['post-media', postId] });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = detectKind(file);
        if (kind === 'video') {
          setPendingVideo(file);
          return;
        }
        await uploadPostMedia({ postId, file });
      }
      refresh();
      toast.success('Upload concluído');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleVideoThumbnail(thumbnail: File) {
    if (!pendingVideo) return;
    setUploading(true);
    try {
      await uploadPostMedia({ postId, file: pendingVideo, thumbnail });
      setPendingVideo(null);
      refresh();
      toast.success('Vídeo enviado');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {media.map((m) => (
          <div key={m.id} className="relative aspect-square overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200/80 group">
            {m.kind === 'image' ? (
              <img src={m.url} alt={m.original_filename} className="w-full h-full object-cover" />
            ) : (
              <video src={m.url ?? undefined} poster={m.thumbnail_url ?? undefined} muted className="w-full h-full object-cover" />
            )}
            {m.is_cover && (
              <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] font-semibold bg-stone-900/85 text-white px-1.5 py-0.5 rounded-full">
                <Star className="h-2.5 w-2.5" /> capa
              </span>
            )}
            {!disabled && (
              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!m.is_cover && (
                  <button
                    type="button"
                    onClick={() => handleSetCover(m.id)}
                    title="Definir como capa"
                    className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-stone-900"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(m.id)}
                  title="Remover"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-stone-900/85 text-white hover:bg-rose-600"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
        {!disabled && (
          <label className="flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 cursor-pointer transition-colors">
            <Upload className="h-4 w-4" />
            <span className="text-[11px]">{uploading ? 'Enviando…' : 'Adicionar'}</span>
            <input type="file" multiple accept="image/*,video/*" hidden onChange={(e) => handleFiles(e.target.files)} />
          </label>
        )}
      </div>

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
    </div>
  );
}

// Exported helper so WorkflowDrawer can gate the "send to client" button.
export function hasVideoMissingThumbnail(media: PostMedia[]): boolean {
  return media.some((m) => m.kind === 'video' && !m.thumbnail_r2_key);
}
