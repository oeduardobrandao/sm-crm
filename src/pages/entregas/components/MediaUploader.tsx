import { useState, useCallback, useRef } from 'react';
import { Upload, X, GripVertical, Film } from 'lucide-react';
import { uploadPostMediaFile, addPostMedia, removePostMedia, deletePostMediaFile, type PostMedia } from '../../../store';

interface MediaUploaderProps {
  postId: number;
  contaId: string;
  tipo: 'feed' | 'reels' | 'carrossel';
  mediaItems: PostMedia[];
  onMediaChange: (items: PostMedia[]) => void;
}

const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4'];

export function MediaUploader({ postId, contaId, tipo, mediaItems, onMediaChange }: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReels = tipo === 'reels';
  const isCarousel = tipo === 'carrossel';
  const maxItems = isCarousel ? 10 : 1;

  const acceptedTypes = isReels
    ? ACCEPTED_VIDEO_TYPES
    : [...ACCEPTED_IMAGE_TYPES, ...(isCarousel ? ACCEPTED_VIDEO_TYPES : [])];

  const validateFile = (file: File): string | null => {
    if (isReels && !ACCEPTED_VIDEO_TYPES.includes(file.type)) return 'Reels requer um arquivo MP4';
    if (!isReels && !acceptedTypes.includes(file.type)) return 'Formato não suportado. Use JPEG, PNG ou MP4';
    const isVideo = ACCEPTED_VIDEO_TYPES.includes(file.type);
    if (isVideo && file.size > MAX_VIDEO_SIZE) return 'Vídeo excede 100 MB';
    if (!isVideo && file.size > MAX_IMAGE_SIZE) return 'Imagem excede 8 MB';
    return null;
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const remaining = maxItems - mediaItems.length;
    if (remaining <= 0) return;
    const toUpload = fileArray.slice(0, remaining);

    setUploading(true);
    try {
      const newItems: PostMedia[] = [];
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        const err = validateFile(file);
        if (err) { alert(err); continue; }

        const mediaType = ACCEPTED_VIDEO_TYPES.includes(file.type) ? 'video' as const : 'image' as const;
        const { storagePath, publicUrl } = await uploadPostMediaFile(contaId, postId, file);
        const saved = await addPostMedia({
          post_id: postId,
          storage_path: storagePath,
          public_url: publicUrl,
          media_type: mediaType,
          position: mediaItems.length + i,
        });
        newItems.push(saved);
      }
      onMediaChange([...mediaItems, ...newItems]);
    } finally {
      setUploading(false);
    }
  }, [postId, contaId, mediaItems, maxItems, onMediaChange]);

  const handleRemove = useCallback(async (item: PostMedia) => {
    await deletePostMediaFile(item.storage_path);
    await removePostMedia(item.id!);
    onMediaChange(mediaItems.filter(m => m.id !== item.id));
  }, [mediaItems, onMediaChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleReorder = useCallback((fromIdx: number, toIdx: number) => {
    const reordered = [...mediaItems];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updated = reordered.map((m, i) => ({ ...m, position: i }));
    onMediaChange(updated);
  }, [mediaItems, onMediaChange]);

  return (
    <div className="media-uploader">
      {mediaItems.length > 0 && (
        <div className="media-uploader__grid">
          {mediaItems.map((item, idx) => (
            <div
              key={item.id}
              className={`media-uploader__thumb${dragIdx === idx ? ' media-uploader__thumb--dragging' : ''}`}
              draggable={isCarousel}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) handleReorder(dragIdx, idx);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
            >
              {isCarousel && <GripVertical className="h-3 w-3 media-uploader__grip" />}
              {item.media_type === 'video' ? (
                <div className="media-uploader__video-icon"><Film className="h-6 w-6" /></div>
              ) : (
                <img src={item.public_url} alt="" className="media-uploader__img" />
              )}
              <button
                type="button"
                className="media-uploader__remove"
                onClick={() => handleRemove(item)}
                title="Remover"
              >
                <X className="h-3 w-3" />
              </button>
              {idx === 0 && <span className="media-uploader__badge">Principal</span>}
            </div>
          ))}
        </div>
      )}

      {mediaItems.length < maxItems && (
        <div
          className={`media-uploader__dropzone${dragOver ? ' media-uploader__dropzone--active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept={acceptedTypes.join(',')}
            multiple={isCarousel}
            onChange={e => e.target.files && handleFiles(e.target.files)}
          />
          {uploading ? (
            <p className="text-sm text-muted-foreground">Enviando...</p>
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-1">
                {isReels ? 'Arraste um vídeo MP4 ou clique' :
                 isCarousel ? `Arraste imagens ou vídeos (${mediaItems.length}/${maxItems})` :
                 'Arraste uma imagem ou clique'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isReels ? 'MP4, até 100 MB' : 'JPEG/PNG até 8 MB' + (isCarousel ? ', MP4 até 100 MB' : '')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
