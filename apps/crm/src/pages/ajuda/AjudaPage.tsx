import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { getPublishedArticles } from '@/store/kb';
import { ALL_CATEGORIES, CATEGORY_LABELS } from './categoryConfig';
import { SectionCard } from './components/SectionCard';
import { ArticleCard } from './components/ArticleCard';

export default function AjudaPage() {
  const [search, setSearch] = useState('');

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['kb-articles'],
    queryFn: getPublishedArticles,
  });

  const sections = useMemo(() => {
    return ALL_CATEGORIES
      .map(cat => ({
        category: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        count: articles.filter(a => a.category === cat).length,
      }))
      .filter(s => s.count > 0);
  }, [articles]);

  const filteredArticles = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return articles.filter(
      a => a.title.toLowerCase().includes(q) || a.content_plain.toLowerCase().includes(q),
    );
  }, [articles, search]);

  const isSearching = search.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="header">
        <div className="header-title">
          <h1>Central de Ajuda</h1>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-light)]" />
        <Input
          placeholder="Buscar artigos..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : isSearching ? (
        filteredArticles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[0.9rem] text-[var(--text-light)]">
              Nenhum artigo encontrado para esta busca.
            </p>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {filteredArticles.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[0.9rem] text-[var(--text-light)]">
            Nenhum artigo publicado ainda.
          </p>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {sections.map(s => (
            <SectionCard key={s.category} category={s.category} label={s.label} articleCount={s.count} />
          ))}
        </div>
      )}
    </div>
  );
}
