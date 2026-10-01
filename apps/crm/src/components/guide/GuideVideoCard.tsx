import { useState, type CSSProperties } from 'react';
import { Check, Play, RotateCcw } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import { captureEvent } from '../../lib/analytics';
import type { KbVideo } from '../../store/kbVideos';
import { formatDuration, isCompleted, type ProgressMap } from '../../pages/ajuda/videos/playlist';
import {
  usePlaybackProgress,
  type SaveProgress,
} from '../../pages/ajuda/videos/usePlaybackProgress';

/** "1 minuto", "N minutos" (arredondado, mínimo 1); '' sem duração utilizável. */
export function videoLengthLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  return min === 1 ? '1 minuto' : `${min} minutos`;
}

function eyebrow(variant: 'featured' | 'inline', length: string): string {
  if (variant === 'featured')
    return length ? `Comece por aqui · vídeo de ${length}` : 'Comece por aqui';
  return length ? `Prefere ver? Vídeo de ${length}` : 'Prefere ver? Assista ao vídeo';
}

export interface GuideVideoCardProps {
  video: KbVideo;
  progress: ProgressMap;
  onSave: SaveProgress;
  /** Página do guia, ou 'home' para o card em destaque. Vai para o analytics. */
  pageId: string;
  variant: 'featured' | 'inline';
  onOpenInHelpCenter: (slug: string) => void;
}

const linkButton: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--text-muted)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** Card de um tutorial dentro do guia. Fechado é um único botão; aberto toca o vídeo ali mesmo,
 * salvando o progresso no mesmo lugar que a Central de Ajuda lê. */
export function GuideVideoCard({
  video,
  progress,
  onSave,
  pageId,
  variant,
  onOpenInHelpCenter,
}: GuideVideoCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <ExpandedVideo
        video={video}
        progress={progress}
        onSave={onSave}
        onClose={() => setExpanded(false)}
        onOpenInHelpCenter={onOpenInHelpCenter}
      />
    );
  }

  const featured = variant === 'featured';
  const watched = isCompleted(progress, video.id);
  const duration = formatDuration(video.duration_seconds);
  const thumbWidth = featured ? 160 : 128;

  return (
    <button
      type="button"
      aria-label={`${watched ? 'Ver de novo' : 'Assistir'} o vídeo ${video.title}`}
      onClick={() => {
        captureEvent('guide_video_played', { page: pageId, slug: video.slug });
        setExpanded(true);
      }}
      style={{
        marginTop: featured ? 16 : 14,
        width: '100%',
        minHeight: 44,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: featured ? '10px 14px 10px 10px' : '8px 12px 8px 8px',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        background: featured ? 'var(--surface-1, #f5f6f8)' : 'var(--card-bg, #ffffff)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden="true"
        className="max-[479px]:!w-28"
        style={{
          position: 'relative',
          display: 'block',
          flex: 'none',
          width: thumbWidth,
          aspectRatio: '16 / 9',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#12151a',
        }}
      >
        {video.thumbnail_url && (
          <img
            src={video.thumbnail_url}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: watched ? 0.55 : 1,
            }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 30,
            height: 30,
            marginLeft: -15,
            marginTop: -15,
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: watched ? 'var(--success)' : 'rgba(18,21,26,.78)',
            color: watched ? '#0a0c0f' : '#ffffff',
          }}
        >
          {watched ? <Check className="h-4 w-4" /> : <Play className="h-3 w-3 fill-current" />}
        </span>
        {duration && (
          <span
            style={{
              position: 'absolute',
              right: 5,
              bottom: 5,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(18,21,26,.82)',
              color: '#ffffff',
              fontSize: '0.66rem',
              fontWeight: 600,
            }}
          >
            {duration}
          </span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        {watched ? (
          <span
            style={{
              display: 'inline-flex',
              gap: 5,
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
            }}
          >
            <Check className="h-3 w-3" style={{ color: 'var(--success)' }} />
            Assistido
          </span>
        ) : (
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {eyebrow(variant, videoLengthLabel(video.duration_seconds))}
          </span>
        )}
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontSize: featured ? '0.9rem' : '0.875rem',
            fontWeight: 600,
          }}
        >
          {video.title}
        </span>
        {featured && (
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: '0.78rem',
              lineHeight: 1.45,
              color: 'var(--text-muted)',
            }}
          >
            Um tour rápido antes das trilhas. Os outros vídeos aparecem em cada passo.
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          buttonVariants({ variant: featured && !watched ? 'default' : 'outline', size: 'sm' }),
          'pointer-events-none flex-none max-[479px]:hidden',
        )}
      >
        {watched ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3 w-3 fill-current" />
        )}
        {watched ? 'Ver de novo' : 'Assistir'}
      </span>
    </button>
  );
}

function ExpandedVideo({
  video,
  progress,
  onSave,
  onClose,
  onOpenInHelpCenter,
}: {
  video: KbVideo;
  progress: ProgressMap;
  onSave: SaveProgress;
  onClose: () => void;
  onOpenInHelpCenter: (slug: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { handlers, positionRef, resumeRef } = usePlaybackProgress(video.id, progress, onSave);

  return (
    <div style={{ marginTop: 14 }}>
      <div
        className="relative aspect-video w-full overflow-hidden bg-black"
        style={{ borderRadius: 10 }}
      >
        {failed ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white"
          >
            <p className="text-[0.9rem]">Não foi possível carregar este vídeo.</p>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                resumeRef.current =
                  positionRef.current > 0 ? positionRef.current : resumeRef.current;
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <VideoPlayer
            key={attempt}
            hlsSrc={video.hls_url}
            src={video.hls_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            autoPlay
            className="h-full w-full"
            {...handlers}
            onFatalError={() => setFailed(true)}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 8,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{video.title}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          <button type="button" style={linkButton} onClick={() => onOpenInHelpCenter(video.slug)}>
            Ver na Central de Ajuda
          </button>
          <button type="button" style={linkButton} onClick={onClose}>
            Fechar vídeo
          </button>
        </span>
      </div>
    </div>
  );
}
