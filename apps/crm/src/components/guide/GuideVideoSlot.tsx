import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { useGuide } from './GuideContext';
import { GuideVideoCard } from './GuideVideoCard';
import { useKbVideoSeries, useVideoProgress } from '../../pages/ajuda/videos/useKbVideos';
import { formatDuration } from '../../pages/ajuda/videos/playlist';
import type { KbVideo, KbVideoSeries } from '../../store/kbVideos';

export function findVideoBySlug(series: KbVideoSeries[], slug: string): KbVideo | null {
  for (const s of series) {
    const found = s.videos.find((v) => v.slug === slug);
    if (found) return found;
  }
  return null;
}

/** Sai do guia para a Central de Ajuda como o "Fazer agora" sai: sem dismissal, e o guia
 * reabre nesta página. */
function useOpenInHelpCenter(pageId: string) {
  const g = useGuide();
  const navigate = useNavigate();
  return (slug: string) => {
    if (pageId !== 'home') g?.setLastPage(pageId);
    g?.closeForAction();
    navigate(`/ajuda/video/${slug}`);
  };
}

/** Só é renderizado dentro do DialogContent, então as queries de vídeo só rodam com o guia
 * aberto. Slug sem vídeo publicado (rascunho, processando ou renomeado) não renderiza nada. */
export function GuideVideoSlot({
  slug,
  pageId,
  variant,
}: {
  slug: string;
  pageId: string;
  variant: 'featured' | 'inline';
}) {
  const { data: series } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const video = useMemo(() => findVideoBySlug(series ?? [], slug), [series, slug]);
  // O progresso semeia o player uma vez, na montagem: sem esperar, um clique rápido perde o retomar.
  if (!video || progressLoading) return null;
  return (
    <GuideVideoCard
      key={video.id}
      video={video}
      progress={progress}
      onSave={save}
      pageId={pageId}
      variant={variant}
      onOpenInHelpCenter={openInHelpCenter}
    />
  );
}

/** Bloco da página de fechamento que aponta para a próxima série. */
export function GuideMoreVideos({ seriesSlug, pageId }: { seriesSlug: string; pageId: string }) {
  const { data: series } = useKbVideoSeries();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const s = series?.find((x) => x.slug === seriesSlug);
  if (!s || s.videos.length === 0) return null;
  const count = s.videos.length;
  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        padding: '14px 15px',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Série {s.title} · {count} {count === 1 ? 'vídeo' : 'vídeos'}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '0.875rem', fontWeight: 600 }}>
        Quando quiser ir além
      </p>
      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}
      >
        {s.videos.map((video) => {
          const duration = formatDuration(video.duration_seconds);
          return (
            <li
              key={video.id}
              style={{
                borderRadius: 8,
                background: 'var(--surface-2, #eceef2)',
                padding: 10,
                fontSize: '0.75rem',
                fontWeight: 600,
                lineHeight: 1.35,
              }}
            >
              {video.title}
              {duration && (
                <span
                  style={{
                    display: 'block',
                    marginTop: 4,
                    fontWeight: 400,
                    color: 'var(--text-muted)',
                  }}
                >
                  {duration}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Ficam na Central de Ajuda, junto com os vídeos do guia.
        </p>
        <Button variant="outline" size="sm" onClick={() => openInHelpCenter(s.videos[0].slug)}>
          Ver vídeos
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
