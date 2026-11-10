import { useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DashboardTopVideo } from '../../types';
import { sanitizeExternalUrl } from '../../lib/security';
import { prefersReducedMotion } from '../../lib/prefersReducedMotion';
import { formatCompact, formatDuration } from '../../lib/dashboardFormat';

const CARD_CLASS =
  'snap-start shrink-0 basis-[46%] sm:basis-auto rounded-2xl overflow-hidden border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-[#1a1e26]';

/** The share url as a safe href, or null when it is missing or not http(s). */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  const href = sanitizeExternalUrl(url);
  return href && href !== '#' && href !== 'about:blank' ? href : null;
}

export function TopVideosRow({ videos }: { videos: DashboardTopVideo[] }) {
  const { t, i18n } = useTranslation('hubHome');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    setActiveIndex(0);
    trackRef.current?.scrollTo?.({ left: 0 });
  }, [videos]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function handleScroll() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = trackRef.current;
      if (!el) return;
      const center = el.scrollLeft + el.clientWidth / 2;
      let nearest = 0;
      let best = Infinity;
      Array.from(el.children).forEach((child, i) => {
        const c = child as HTMLElement;
        const distance = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
        if (distance < best) {
          best = distance;
          nearest = i;
        }
      });
      setActiveIndex(nearest);
    });
  }

  function scrollToCard(index: number) {
    const card = trackRef.current?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  if (videos.length === 0) {
    return (
      <p className="text-sm text-stone-400 py-4">
        {t('topVideos.noVideos', 'Nenhum vídeo no período selecionado.')}
      </p>
    );
  }

  const rate = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex items-start gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 sm:grid sm:grid-cols-3 md:grid-cols-5 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {videos.map((v) => {
          const href = safeHref(v.shareUrl);
          const showImage = v.coverUrl && !failedImages.has(v.id);
          const duration = formatDuration(v.durationSeconds);
          const body = (
            <>
              <div className="relative overflow-hidden aspect-[9/13] hub-bg-soft">
                {showImage ? (
                  <img
                    src={v.coverUrl!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="block w-full h-full object-cover"
                    onError={() => setFailedImages((prev) => new Set(prev).add(v.id))}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center hub-tx3">
                    <Music2 size={28} aria-hidden="true" />
                  </div>
                )}
                {duration && (
                  <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[12px] px-1.5 py-0.5 rounded font-semibold">
                    {duration}
                  </span>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[12px] text-stone-500 dark:text-stone-400">
                    {t('topPosts.stats.views', 'Visualizações')}
                  </span>
                  <span className="text-[12px] font-bold text-stone-900 dark:text-stone-100">
                    {formatCompact(v.views, locale)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12px] text-stone-500 dark:text-stone-400">
                    {t('topPosts.stats.engagement', 'Engajamento')}
                  </span>
                  <span className="text-[12px] font-bold text-emerald-500">
                    {v.engagementRate == null ? '—' : `${rate.format(v.engagementRate)}%`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12px] text-stone-500 dark:text-stone-400">
                    {t('topVideos.stats.shares', 'Compartilhamentos')}
                  </span>
                  <span className="text-[12px] font-bold text-stone-900 dark:text-stone-100">
                    {formatCompact(v.shares, locale)}
                  </span>
                </div>
              </div>
            </>
          );
          return href ? (
            <a
              key={v.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${CARD_CLASS} transition-transform hover:scale-[1.02]`}
            >
              {body}
            </a>
          ) : (
            <div key={v.id} className={CARD_CLASS}>
              {body}
            </div>
          );
        })}
      </div>

      {videos.length > 1 && (
        <div className="flex sm:hidden justify-center gap-1.5 mt-3">
          {videos.map((v, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={v.id}
                type="button"
                aria-label={t('topVideos.goToVideo', 'Ir para vídeo {{index}}', { index: i + 1 })}
                aria-current={active}
                onClick={() => scrollToCard(i)}
                className="flex items-center justify-center py-2.5 px-1.5 -my-2"
              >
                <span
                  className={`h-1.5 rounded-full transition-all ${
                    active
                      ? 'w-4 bg-stone-800 dark:bg-stone-200'
                      : 'w-1.5 bg-stone-300 dark:bg-stone-600'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
