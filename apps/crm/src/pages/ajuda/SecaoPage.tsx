import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { CardGridSkeleton } from '@/components/ui/skeletons';
import { Button } from '@/components/ui/button';
import { getPublishedArticles } from '@/store/kb';
import { ALL_CATEGORIES, categoryLabel } from './categoryConfig';
import { ArticleCard } from './components/ArticleCard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { GroupedList } from '@/components/mobile/GroupedList';
import { ListSkeleton } from '@/components/ui/skeletons';
import { ArticleCell } from './phone/AjudaPhone';
import './phone/ajudaPhone.css';

export default function SecaoPage() {
  const { t } = useTranslation('help');
  const { category } = useParams<{ category: string }>();
  const isPhone = !useIsDesktop(768);

  const isValidCategory = !!category && ALL_CATEGORIES.includes(category);
  const label = category ? categoryLabel(t, category) : '';

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const sectionArticles = useMemo(
    () => articles.filter((a) => a.category === category),
    [articles, category],
  );

  const inToolbar = usePageToolbar(isValidCategory ? { title: label } : null);

  if (isPhone) {
    return (
      <div className="phone-kit">
        <PhoneNavBar backLabel={t('backToHelp')} fallbackTo="/ajuda" />
        <div className="phone-ajuda-head">
          <h1 className="phone-ajuda-title">
            {isValidCategory ? label : t('section.notFoundTitle')}
          </h1>
        </div>
        {!isValidCategory ? null : isLoading ? (
          <ListSkeleton rows={5} />
        ) : sectionArticles.length === 0 ? (
          <p className="phone-ajuda-empty">{t('section.empty')}</p>
        ) : (
          <GroupedList
            aria-label={t('section.articlesOf', { label })}
            footer={t('article.count', { count: sectionArticles.length })}
          >
            {sectionArticles.map((article) => (
              <ArticleCell key={article.id} article={article} />
            ))}
          </GroupedList>
        )}
      </div>
    );
  }

  if (!isValidCategory) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-[0.9rem] text-[var(--text-light)]">{t('section.notFound')}</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">
            {t('backToHelpShort')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <Link
          to="/ajuda"
          className="inline-flex items-center gap-1.5 text-[0.82rem] text-[var(--text-light)] hover:text-[var(--text-main)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('title')}
        </Link>
      </div>

      {!inToolbar && (
        <div className="header">
          <div className="header-title">
            <h1>{label}</h1>
          </div>
        </div>
      )}

      {isLoading ? (
        <CardGridSkeleton cards={6} />
      ) : sectionArticles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[0.9rem] text-[var(--text-light)]">{t('section.empty')}</p>
        </div>
      ) : (
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
        >
          {sectionArticles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
