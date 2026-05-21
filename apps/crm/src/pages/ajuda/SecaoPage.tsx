import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { getPublishedArticles } from '@/store/kb';
import { ALL_CATEGORIES, CATEGORY_LABELS } from './categoryConfig';
import { ArticleCard } from './components/ArticleCard';

export default function SecaoPage() {
  const { category } = useParams<{ category: string }>();

  const isValidCategory = !!category && ALL_CATEGORIES.includes(category);
  const label = category ? (CATEGORY_LABELS[category] ?? category) : '';

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const sectionArticles = useMemo(
    () => articles.filter(a => a.category === category),
    [articles, category],
  );

  if (!isValidCategory) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-[0.9rem] text-[var(--text-light)]">Seção não encontrada.</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">Voltar à Central de Ajuda</Button>
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
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : sectionArticles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[0.9rem] text-[var(--text-light)]">
            Nenhum artigo nesta seção ainda.
          </p>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {sectionArticles.map(article => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
