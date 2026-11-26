import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CardGridSkeleton } from '@/components/ui/skeletons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { getPublishedArticles } from '@/store/kb';
import { ALL_CATEGORIES, categoryLabel } from './categoryConfig';
import { filterArticles } from './filterArticles';
import { SectionCard } from './components/SectionCard';
import { ArticleCard } from './components/ArticleCard';
import { VideoPlaylistHero } from './videos/VideoPlaylistHero';
import { VideoResultCard } from './videos/VideoResultCard';
import { useKbVideoSeries } from './videos/useKbVideos';
import { filterVideos } from './videos/playlist';
import { AjudaPhone } from './phone/AjudaPhone';

export default function AjudaPage() {
  const { t } = useTranslation('help');
  // `?q=` vem do item "Ver todos em Ajuda" da busca global (⌘K).
  const [searchParams] = useSearchParams();
  const isDesktop = useIsDesktop(768);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const sections = useMemo(() => {
    return ALL_CATEGORIES.map((cat) => ({
      category: cat,
      label: categoryLabel(t, cat),
      count: articles.filter((a) => a.category === cat).length,
    })).filter((s) => s.count > 0);
  }, [articles, t]);

  const filteredArticles = useMemo(() => filterArticles(articles, search), [articles, search]);

  const { data: videoSeries = [] } = useKbVideoSeries();
  const filteredVideos = useMemo(() => filterVideos(videoSeries, search), [videoSeries, search]);

  const isSearching = search.trim().length > 0;

  const inToolbar = usePageToolbar({ title: t('title') });

  if (!isDesktop) {
    return (
      <AjudaPhone
        search={search}
        onSearchChange={setSearch}
        requestedVideoSlug={searchParams.get('video')}
        isLoading={isLoading}
        isSearching={isSearching}
        sections={sections}
        articles={filteredArticles}
        videos={filteredVideos}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!inToolbar && (
        <div className="header">
          <div className="header-title">
            <h1>{t('title')}</h1>
          </div>
        </div>
      )}

      <VideoPlaylistHero requestedSlug={searchParams.get('video')} />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-light)]" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton cards={6} />
      ) : isSearching ? (
        filteredArticles.length === 0 && filteredVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[0.9rem] text-[var(--text-light)]">{t('noResults')}</p>
          </div>
        ) : (
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
            {filteredVideos.map((hit) => (
              <VideoResultCard key={`video-${hit.video.id}`} hit={hit} />
            ))}
            {filteredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[0.9rem] text-[var(--text-light)]">{t('noArticles')}</p>
        </div>
      ) : (
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {sections.map((s) => (
            <SectionCard
              key={s.category}
              category={s.category}
              label={s.label}
              articleCount={s.count}
            />
          ))}
        </div>
      )}
    </div>
  );
}
