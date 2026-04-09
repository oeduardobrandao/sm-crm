import { useState, useEffect } from 'react';
import { X, Calendar, Instagram, AlertTriangle, Music } from 'lucide-react';
import { toast } from 'sonner';
import { getPostMedia, type WorkflowPost, type PostMedia } from '../../../store';
import { scheduleInstagramPost, publishInstagramPostNow } from '../../../services/instagram-publish';
import { MediaUploader } from './MediaUploader';

interface ScheduleModalProps {
  post: WorkflowPost;
  contaId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function getDefaultScheduleTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function getMinScheduleTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 10);
  return d.toISOString().slice(0, 16);
}

function getMaxScheduleTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 75);
  return d.toISOString().slice(0, 16);
}

export function ScheduleModal({ post, contaId, onClose, onSuccess }: ScheduleModalProps) {
  const [caption, setCaption] = useState(post.conteudo_plain || '');
  const [musicNote, setMusicNote] = useState('');
  const [scheduledAt, setScheduledAt] = useState(getDefaultScheduleTime());
  const [coverUrl, setCoverUrl] = useState('');
  const [mediaItems, setMediaItems] = useState<PostMedia[]>([]);
  const [coverMedia, setCoverMedia] = useState<PostMedia[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPostMedia(post.id!).then(items => {
      setMediaItems(items);
      setLoading(false);
    });
  }, [post.id]);

  const handleSubmit = async (publishNow: boolean) => {
    if (mediaItems.length === 0) {
      toast.error('Adicione pelo menos uma mídia');
      return;
    }
    if (caption.length > 2200) {
      toast.error('Legenda excede 2.200 caracteres');
      return;
    }
    if (post.tipo === 'carrossel' && mediaItems.length < 2) {
      toast.error('Carrossel requer pelo menos 2 mídias');
      return;
    }

    setSubmitting(true);
    try {
      if (publishNow) {
        await publishInstagramPostNow(post.id!, {
          caption,
          cover_url: coverUrl || undefined,
          music_note: musicNote || undefined,
        });
        toast.success('Post publicado no Instagram!');
      } else {
        await scheduleInstagramPost(post.id!, {
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
          cover_url: coverUrl || undefined,
          music_note: musicNote || undefined,
        });
        toast.success('Post agendado no Instagram!');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao agendar post');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="schedule-modal-overlay" onClick={onClose}>
        <div className="schedule-modal" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground p-6">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-modal-overlay" onClick={onClose}>
      <div className="schedule-modal" onClick={e => e.stopPropagation()}>
        <div className="schedule-modal__header">
          <div className="flex items-center gap-2">
            <Instagram className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Agendar no Instagram</h2>
          </div>
          <button type="button" onClick={onClose} className="schedule-modal__close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="schedule-modal__body">
          <div className="schedule-modal__section">
            <label className="text-sm font-medium">
              {post.tipo === 'reels' ? 'Vídeo' : post.tipo === 'carrossel' ? 'Mídias (2-10)' : 'Imagem'}
            </label>
            <MediaUploader
              postId={post.id!}
              contaId={contaId}
              tipo={post.tipo as 'feed' | 'reels' | 'carrossel'}
              mediaItems={mediaItems}
              onMediaChange={setMediaItems}
            />
          </div>

          {post.tipo === 'reels' && (
            <div className="schedule-modal__section">
              <label className="text-sm font-medium">Capa do Reel (opcional)</label>
              <MediaUploader
                postId={post.id!}
                contaId={contaId}
                tipo="feed"
                mediaItems={coverMedia}
                onMediaChange={items => {
                  setCoverMedia(items);
                  setCoverUrl(items[0]?.public_url || '');
                }}
              />
            </div>
          )}

          <div className="schedule-modal__section">
            <label className="text-sm font-medium">
              Legenda <span className="text-muted-foreground">({caption.length}/2.200)</span>
            </label>
            <textarea
              className="schedule-modal__textarea"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              maxLength={2200}
              rows={4}
              placeholder="Escreva a legenda do post..."
            />
          </div>

          <div className="schedule-modal__section">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Music className="h-3.5 w-3.5" />
              Lembrete de música
              <span className="text-xs text-muted-foreground">(adicionar manualmente no app)</span>
            </label>
            <input
              type="text"
              className="schedule-modal__input"
              value={musicNote}
              onChange={e => setMusicNote(e.target.value)}
              placeholder="Ex: Trending audio #123..."
            />
            {musicNote && (
              <div className="schedule-modal__warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="text-xs">Música não pode ser adicionada via API. Lembre-se de adicionar manualmente no app do Instagram.</span>
              </div>
            )}
          </div>

          <div className="schedule-modal__section">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Data e hora de publicação
            </label>
            <input
              type="datetime-local"
              className="schedule-modal__input"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={getMinScheduleTime()}
              max={getMaxScheduleTime()}
            />
          </div>
        </div>

        <div className="schedule-modal__footer">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleSubmit(true)}
            disabled={submitting}
          >
            {submitting ? 'Publicando...' : 'Publicar agora'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            {submitting ? 'Agendando...' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
