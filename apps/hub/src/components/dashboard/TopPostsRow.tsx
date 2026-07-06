import { useEffect, useRef, useState } from 'react';
import type { DashboardTopPost } from '../../types';

const TIPO_COLORS: Record<string, string> = {
  IMAGE: '#3b82f6',
  VIDEO: '#8b5cf6',
  CAROUSEL_ALBUM: '#10b981',
};

const TIPO_LABELS: Record<string, string> = {
  CAROUSEL_ALBUM: 'Carrossel',
  VIDEO: 'Reels',
  IMAGE: 'Imagem',
};

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface TopPostsRowProps {
  posts: DashboardTopPost[];
}

export function TopPostsRow({ posts }: TopPostsRowProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // A new period returns a fresh posts array — snap the active dot back to the start.
  useEffect(() => {
    setActiveIndex(0);
    trackRef.current?.scrollTo?.({ left: 0 });
  }, [posts]);

  // Cancel any queued scroll frame if the row unmounts (e.g. dashboard period change).
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
        const cardCenter = c.offsetLeft + c.offsetWidth / 2;
        const distance = Math.abs(cardCenter - center);
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
    card?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  if (posts.length === 0) {
    return <p className="text-sm text-stone-400 py-4">Nenhum post no período selecionado.</p>;
  }

  return (
    <div>
      {/* Mobile: horizontal snap carousel with a peek. Tablet/desktop: the grid, unchanged. */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 sm:grid sm:grid-cols-3 md:grid-cols-5 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {posts.map((post) => {
          const color = TIPO_COLORS[post.mediaType] ?? '#6b7280';
          const showImage = post.thumbnailUrl && !failedImages.has(post.id);
          return (
            <a
              key={post.id}
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="snap-start shrink-0 basis-[84%] sm:basis-auto rounded-2xl overflow-hidden border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-[#1a1e26] transition-transform hover:scale-[1.02]"
            >
              <div
                className="aspect-square relative overflow-hidden"
                style={
                  showImage
                    ? undefined
                    : { background: `linear-gradient(135deg, ${color}, ${color}dd)` }
                }
              >
                {showImage ? (
                  <img
                    src={post.thumbnailUrl!}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setFailedImages((prev) => new Set(prev).add(post.id))}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-[60px] h-[60px] rounded-lg bg-white/15" />
                  </div>
                )}
                <span className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                  {TIPO_LABELS[post.mediaType] ?? post.mediaType}
                </span>
              </div>
              <div className="p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">Alcance</span>
                  <span className="text-[11px] font-bold text-stone-900 dark:text-stone-100">
                    {formatNumber(post.reach)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">
                    Engajamento
                  </span>
                  <span className="text-[11px] font-bold text-emerald-500">
                    {post.engagementRate}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">Salvos</span>
                  <span className="text-[11px] font-bold text-stone-900 dark:text-stone-100">
                    {post.saved}
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {/* Pagination dots — mobile only */}
      {posts.length > 1 && (
        <div className="flex sm:hidden justify-center gap-1.5 mt-3">
          {posts.map((post, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={post.id}
                type="button"
                aria-label={`Ir para post ${i + 1}`}
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
