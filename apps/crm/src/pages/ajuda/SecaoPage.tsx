import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { CardGridSkeleton } from '@/components/ui/skeletons';
import { Button } from '@/components/ui/button';
import { getPublishedArticles } from '@/store/kb';
import { ALL_CATEGORIES, CATEGORY_LABELS } from './categoryConfig';
import { ArticleCard } from './components/ArticleCard';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { GroupedList } from '@/components/mobile/GroupedList';
import { ListSkeleton } from '@/components/ui/skeletons';
import { ArticleCell } from './phone/AjudaPhone';
import './phone/ajudaPhone.css';

export default function SecaoPage() {
  const { category } = useParams<{ category: string }>();
  const isPhone = !useIsDesktop(768);

  const isValidCategory = !!category && ALL_CATEGORIES.includes(category);
  const label = category ? (CATEGORY_LABELS[category] ?? category) : '';

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const sectionArticles = useMemo(
    () => articles.filter((a) => a.category === category),
    [articles, category],
  );

  if (isPhone) {
    return (
      <div className="phone-kit">
        <PhoneNavBar backLabel="Voltar para Central de Ajuda" fallbackTo="/ajuda" />
        <div className="phone-ajuda-head">
          <h1 className="phone-ajuda-title">{isValidCategory ? label : 'Seção não encontrada'}</h1>
        </div>
        {!isValidCategory ? null : isLoading ? (
          <ListSkeleton rows={5} />
        ) : sectionArticles.length === 0 ? (
          <p className="phone-ajuda-empty">Nenhum artigo nesta seção ainda.</p>
        ) : (
          <GroupedList
            aria-label={`Artigos de ${label}`}
            footer={`${sectionArticles.length} ${sectionArticles.length === 1 ? 'artigo' : 'artigos'}`}
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
        <p className="text-[0.9rem] text-[var(--text-light)]">Seção não encontrada.</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">
            Voltar à Central de Ajuda
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
          Central de Ajuda
        </Link>
      </div>

      <div className="header">
        <div className="header-title">
          <h1>{label}</h1>
        </div>
      </div>

      {isLoading ? (
        <CardGridSkeleton cards={6} />
      ) : sectionArticles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[0.9rem] text-[var(--text-light)]">Nenhum artigo nesta seção ainda.</p>
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
