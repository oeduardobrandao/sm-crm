import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getContextLinksForRoute } from '@/store/kb';
import { ArticleLink } from './ArticleLink';

export function ContextHelpLinks() {
  const { pathname } = useLocation();

  const baseRoute = '/' + pathname.split('/').filter(Boolean)[0];

  const { data: links = [] } = useQuery({
    queryKey: ['kb-context-links', baseRoute],
    queryFn: () => getContextLinksForRoute(baseRoute),
    staleTime: 5 * 60 * 1000,
    enabled: !!baseRoute && baseRoute !== '/',
  });

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {links.map((link) => (
        <ArticleLink
          key={link.id}
          slug={link.article?.slug ?? ''}
          label={link.label ?? link.article?.title ?? 'Saiba mais'}
        />
      ))}
    </div>
  );
}
