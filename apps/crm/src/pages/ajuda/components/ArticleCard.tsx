import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, FileText } from 'lucide-react';
import type { KbArticle } from '@/store/kb';
import { resolveInlineImageUrls } from '@/services/inlineImage';
import { CATEGORY_LABELS } from './CategoryFilter';

function useCoverUrl(raw: string | null) {
  const isR2 = !!raw && !raw.startsWith('http');
  const { data } = useQuery({
    queryKey: ['cover-url', raw],
    queryFn: () => resolveInlineImageUrls([raw!]).then((m) => m[raw!] ?? ''),
    enabled: isR2,
    staleTime: 10 * 60 * 1000,
  });
  if (!raw) return null;
  return isR2 ? (data ?? null) : raw;
}

interface ArticleCardProps {
  article: KbArticle;
}

function readingTime(plainText: string): number {
  const words = plainText.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function ArticleCard({ article }: ArticleCardProps) {
  const minutes = readingTime(article.content_plain);
  const categoryLabel = CATEGORY_LABELS[article.category] ?? article.category;
  const coverSrc = useCoverUrl(article.cover_image_url);

  return (
    <Link
      to={`/ajuda/${article.slug}`}
      className="group block rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-0 overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
    >
      {coverSrc ? (
        <div className="aspect-video w-full overflow-hidden bg-[var(--surface-darker)]">
          <img
            src={coverSrc}
            alt={article.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="aspect-video w-full flex items-center justify-center bg-[var(--surface-darker)]">
          <FileText className="h-10 w-10 text-[var(--text-light)] opacity-40" />
        </div>
      )}

      <div className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-block rounded-sm px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider bg-[rgba(234,179,8,0.1)] text-[var(--primary-color)]">
            {categoryLabel}
          </span>
          {article.status === 'draft' && (
            <span className="inline-block rounded-sm px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider bg-[rgba(107,114,128,0.1)] text-[var(--text-light)]">
              Rascunho
            </span>
          )}
        </div>

        <h3 className="mb-2 text-[1.05rem] font-bold text-[var(--text-main)] leading-snug line-clamp-2 font-[var(--font-heading)]">
          {article.title}
        </h3>

        {article.excerpt && (
          <p className="mb-3 text-[0.82rem] text-[var(--text-light)] leading-relaxed line-clamp-2">
            {article.excerpt}
          </p>
        )}

        <div className="flex items-center gap-1 text-[0.72rem] text-[var(--text-light)]">
          <Clock className="h-3 w-3" />
          <span>{minutes} min de leitura</span>
        </div>
      </div>
    </Link>
  );
}
