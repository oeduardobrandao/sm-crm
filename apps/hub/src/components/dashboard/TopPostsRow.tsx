import { useState } from 'react';
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

interface TopPostsRowProps {
  posts: DashboardTopPost[];
}

export function TopPostsRow({ posts }: TopPostsRowProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  if (posts.length === 0) {
    return <p className="text-sm text-stone-400 py-4">Nenhum post no período selecionado.</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
      {posts.map((post) => {
        const color = TIPO_COLORS[post.mediaType] ?? '#6b7280';
        const showImage = post.thumbnailUrl && !failedImages.has(post.id);
        return (
          <a
            key={post.id}
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl overflow-hidden border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-[#1a1e26] transition-transform hover:scale-[1.02]"
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
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Engajamento</span>
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
  );
}
