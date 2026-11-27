import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { useGuide } from './GuideContext';
import { useGuideLeave } from './guideLeave';
import { GuideVideoCard } from './GuideVideoCard';
import { useKbVideoSeries, useVideoProgress } from '../../pages/ajuda/videos/useKbVideos';
import { formatDuration } from '../../pages/ajuda/videos/playlist';
import { recordKbViewSafely } from '../../pages/ajuda/useRecordKbView';
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
  const leave = useGuideLeave();
  return (slug: string) => {
    if (pageId !== 'home') g?.setLastPage(pageId);
    const to = `/ajuda/video/${slug}`;
    // Phone sheet: close, then navigate once its history entry is popped.
    if (leave) return leave(to);
    g?.closeForAction();
    navigate(to);
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
  const { i18n } = useTranslation();
  const { data: series } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const video = useMemo(() => findVideoBySlug(series ?? [], slug), [series, slug]);
  // Os vídeos (título e narração) só existem em português.
  if (i18n.language !== 'pt') return null;
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
      onFirstPlay={(videoId) => recordKbViewSafely({ videoId })}
    />
  );
}

/** Bloco da página de fechamento que aponta para a próxima série. */
export function GuideMoreVideos({ seriesSlug, pageId }: { seriesSlug: string; pageId: string }) {
  const { t, i18n } = useTranslation('guide');
  const { data: series } = useKbVideoSeries();
  const openInHelpCenter = useOpenInHelpCenter(pageId);
  const s = series?.find((x) => x.slug === seriesSlug);
  if (i18n.language !== 'pt') return null;
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
        {t('video.seriesCount', { title: s.title, count })}
      </p>
      <p style={{ margin: '3px 0 0', fontSize: '0.875rem', fontWeight: 600 }}>
        {t('video.goFurther')}
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
          {t('video.seriesNote')}
        </p>
        <Button variant="outline" size="sm" onClick={() => openInHelpCenter(s.videos[0].slug)}>
          {t('video.seeVideos')}
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
