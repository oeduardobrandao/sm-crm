import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  getPublishedMedia,
  type PublishedMediaError,
  type PublishedMediaItem,
} from '../../services/publishedMedia';
import { PublishedCard } from './TargetCards';

/**
 * Seletor ao vivo da aba "Publicados" no fluxo de re-mirar um alvo órfão
 * (automação com `target_unlinked_at`): busca direto na Graph API via
 * `getPublishedMedia`, nunca no espelho `instagram_posts` -- o post que o
 * usuário marcou como postado na mão pode ser recente demais pro sync diário
 * já ter trazido, e é exatamente esse post que precisa aparecer aqui.
 *
 * Paginação por cursor, não por offset: a Graph API não devolve total, então
 * "carregar mais" concatena páginas em vez da paginação numerada do seletor
 * "Publicados" normal (aquele lê de `instagram_posts`, que tem `total`).
 */
export default function LiveMediaPicker({
  clientId,
  selectedId,
  onSelect,
}: {
  clientId: number;
  /** `ig_media_id` do alvo selecionado no momento, se já for do tipo
   * "published" -- destaca o card correspondente quando ele está numa página
   * já carregada. */
  selectedId: string | null;
  onSelect: (post: PublishedMediaItem) => void;
}) {
  const { t } = useTranslation('automations');

  const query = useInfiniteQuery({
    queryKey: ['published-media', clientId],
    queryFn: ({ pageParam }) => getPublishedMedia(clientId, pageParam),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (query.isError) {
    const code = (query.error as PublishedMediaError | null)?.code;
    const message =
      code === 'instagram_not_authorized'
        ? t('form.liveMediaNotAuthorized')
        : code === 'rate_limited'
          ? t('form.liveMediaRateLimited')
          : t('form.liveMediaError');
    return (
      <p style={{ color: 'var(--danger-text)', fontSize: '0.8rem', marginTop: 6 }}>{message}</p>
    );
  }

  const posts = query.data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <>
      <div className="grid grid-cols-4 gap-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {posts.map((post) => (
          <PublishedCard
            key={post.id}
            caption={post.caption}
            thumbnailUrl={post.thumbnail_url}
            permalink={post.permalink}
            permalinkLabel={t('viewPost')}
            selected={selectedId === post.id}
            onSelect={() => onSelect(post)}
          />
        ))}
        {posts.length === 0 && (
          <p
            style={{
              gridColumn: '1 / -1',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
            }}
          >
            {t('form.noLivePosts')}
          </p>
        )}
      </div>
      {query.hasNextPage && (
        <div style={{ marginTop: 6 }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? t('form.loadingMore') : t('form.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}
