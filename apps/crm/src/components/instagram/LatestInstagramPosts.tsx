import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Heart,
  Image as ImageIcon,
  Images,
  MessageCircle,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatDate } from '@/store';
import {
  getInstagramPosts,
  type InstagramPostSummary,
} from '@/services/instagram';
import { sanitizeUrl } from '@/utils/security';
import { InstagramPostCarousel } from './InstagramPostCarousel';

const POSTS_PER_PAGE = 10;

function metricValue(value: number): string {
  return (Number(value) || 0).toLocaleString('pt-BR');
}

export function LatestInstagramPosts({ clienteId }: { clienteId: number }): ReactElement {
  const { t } = useTranslation('clients');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['instagram-posts', clienteId, page],
    queryFn: () => getInstagramPosts(clienteId, page),
  });

  const newestFirst = useMemo(
    () =>
      [...(data?.posts ?? [])].sort(
        (a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime(),
      ),
    [data?.posts],
  );

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / POSTS_PER_PAGE));
  const displayedTotalPages = Math.max(page, totalPages);
  const pagination = (
    <InstagramPostsPagination
      page={page}
      totalPages={displayedTotalPages}
      onPageChange={setPage}
    />
  );

  if (isLoading) {
    return (
      <div className="card latest-instagram-posts__status" role="status">
        <Spinner size="lg" />
        <span className="sr-only">{t('instagram.loadingPosts')}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="card latest-instagram-posts__status" role="alert">
        <span>{t('instagram.postsError', { error: t('instagram.unknownError') })}</span>
        {page > 1 && pagination}
      </div>
    );
  }

  if (newestFirst.length === 0) {
    return (
      <div className="card latest-instagram-posts__status">
        <span>{t('instagram.noPosts')}</span>
        {page > 1 && pagination}
      </div>
    );
  }

  return (
    <InstagramPostCarousel
      title={t('instagram.postsTitle')}
      ariaLabel={t('instagram.postsTitle')}
      icon={<Images aria-hidden="true" size={20} />}
      posts={newestFirst}
      getKey={(post) => post.id}
      renderPost={(post) => <LatestInstagramPostCard post={post} />}
      action={pagination}
    />
  );
}

function InstagramPostsPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}): ReactElement {
  const { t } = useTranslation('clients');

  return (
    <div className="latest-instagram-posts__pagination">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('instagram.previousPage')}
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeft aria-hidden="true" size={16} />
      </Button>
      <span className="latest-instagram-posts__page">
        {t('instagram.pageIndicator', {
          page: String(page),
          total: String(totalPages),
        })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('instagram.nextPage')}
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <ChevronRight aria-hidden="true" size={16} />
      </Button>
    </div>
  );
}

function LatestInstagramPostCard({ post }: { post: InstagramPostSummary }): ReactElement {
  const { t } = useTranslation('clients');
  const thumbnailUrl = sanitizeUrl(post.thumbnail_url);
  const permalink = sanitizeUrl(post.permalink);
  const mediaType = {
    CAROUSEL_ALBUM: t('detail.postType.carrossel'),
    VIDEO: t('detail.postType.reels'),
    IMAGE: t('detail.postType.feed'),
  }[post.media_type] ?? post.media_type;

  return (
    <article className="latest-instagram-post-card">
      <div className="latest-instagram-post-card__media">
        {thumbnailUrl !== '#' ? (
          <img src={thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <ImageIcon aria-hidden="true" size={28} />
        )}
      </div>
      <div className="latest-instagram-post-card__body">
        <div className="latest-instagram-post-card__meta">
          <span>{mediaType}</span>
          <time dateTime={post.posted_at}>{formatDate(post.posted_at.split('T')[0])}</time>
        </div>
        <p className="latest-instagram-post-card__caption">{post.caption || '—'}</p>
        <div className="latest-instagram-post-card__metrics">
          <span aria-label={`${t('instagram.likes')}: ${metricValue(post.likes)}`}>
            <Heart aria-hidden="true" size={15} /> {metricValue(post.likes)}
          </span>
          <span aria-label={`${t('instagram.comments')}: ${metricValue(post.comments)}`}>
            <MessageCircle aria-hidden="true" size={15} /> {metricValue(post.comments)}
          </span>
          <span aria-label={`${t('instagram.reachTooltip')}: ${metricValue(post.reach)}`}>
            <Users aria-hidden="true" size={15} /> {metricValue(post.reach)}
          </span>
          <span
            aria-label={`${t('instagram.impressionsTooltip')}: ${metricValue(post.impressions)}`}
          >
            <Eye aria-hidden="true" size={15} /> {metricValue(post.impressions)}
          </span>
        </div>
        {permalink !== '#' && (
          <a
            className="latest-instagram-post-card__link"
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('instagram.openPost')}
          >
            <ExternalLink aria-hidden="true" size={16} />
            {t('instagram.openPost')}
          </a>
        )}
      </div>
    </article>
  );
}
