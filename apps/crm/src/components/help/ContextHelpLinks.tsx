import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronRight } from 'lucide-react';
import { getContextLinksForRoutes, type KbContextLink } from '@/store/kb';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

function usePhoneViewport() {
  const query = '(max-width: 767px)';
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    setIsPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isPhone;
}

function ArticleMenu({ links }: { links: KbContextLink[] }) {
  return (
    <div className="context-help__list">
      {links.map((link) => {
        const slug = link.article!.slug.trim();
        return (
          <Link key={link.id} to={`/ajuda/${slug}`} className="context-help__article">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>{link.label ?? link.article!.title}</span>
            <ChevronRight className="ml-auto h-4 w-4" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}

export function ContextHelpLinks() {
  const { pathname } = useLocation();
  const isPhone = usePhoneViewport();

  // Candidate routes from most to least specific: '/configuracao/mcp' has its
  // own kb_context_links rows, so a two-segment match must win over the
  // '/configuracao' fallback (matching only the first segment left those rows
  // permanently unreachable).
  const segments = pathname.split('/').filter(Boolean);
  const baseRoute = segments.length > 0 ? '/' + segments[0] : '/';
  const candidateRoutes =
    segments.length > 1 ? [`/${segments[0]}/${segments[1]}`, baseRoute] : [baseRoute];

  const { data: links = [] } = useQuery({
    queryKey: ['kb-context-links', ...candidateRoutes],
    queryFn: () => getContextLinksForRoutes(candidateRoutes),
    staleTime: 5 * 60 * 1000,
    enabled: baseRoute !== '/',
  });

  const validLinks = links.filter((link) => {
    const slug = link.article?.slug;
    return Boolean(slug && slug.trim());
  });

  if (validLinks.length === 0) return null;

  const trigger = (
    <Button variant="ghost" size="sm" className="context-help__trigger">
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      Artigos relacionados
      <span className="context-help__count">{validLinks.length}</span>
    </Button>
  );

  return (
    <div className="context-help">
      {isPhone ? (
        <Sheet>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" className="context-help__sheet">
            <SheetHeader>
              <SheetTitle>Artigos relacionados</SheetTitle>
              <SheetDescription className="sr-only">
                Escolha um artigo relacionado para abrir.
              </SheetDescription>
            </SheetHeader>
            <ArticleMenu links={validLinks} />
          </SheetContent>
        </Sheet>
      ) : (
        <Popover>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="context-help__popover">
            <ArticleMenu links={validLinks} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
