import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronRight } from 'lucide-react';
import { getContextLinksForRoutes, type KbContextLink } from '@/store/kb';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { useIsPhoneShellMatch } from '@/lib/phoneShell';

function usePhoneViewport() {
  return useIsPhoneShellMatch();
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

/**
 * Phone list inside the kit BottomSheet. Rows close the sheet first and navigate once its
 * history entry is gone, so Back from the article returns to the page, not to a dead step.
 */
function PhoneArticleList({ links }: { links: KbContextLink[] }) {
  const { t } = useTranslation('help');
  const navigate = useNavigate();
  const { closeThen } = useSheetActions();
  return (
    <GroupedList aria-label={t('article.related')}>
      {links.map((link) => {
        const slug = link.article!.slug.trim();
        return (
          <Cell
            key={link.id}
            label={link.label ?? link.article!.title}
            icon={<BookOpen />}
            chevron
            onClick={() => closeThen(() => navigate(`/ajuda/${slug}`))}
          />
        );
      })}
    </GroupedList>
  );
}

export function ContextHelpLinks() {
  const { t, i18n } = useTranslation('help');
  // Help Center articles exist only in Portuguese: in any other language the pill would
  // send the user to Portuguese pages, so it stays off.
  const contentAvailable = i18n.language === 'pt';
  const { pathname } = useLocation();
  const isPhone = usePhoneViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    enabled: contentAvailable && baseRoute !== '/',
  });

  const validLinks = links.filter((link) => {
    const slug = link.article?.slug;
    return Boolean(slug && slug.trim());
  });

  if (!contentAvailable || validLinks.length === 0) return null;

  const trigger = (
    <Button variant="ghost" size="sm" className="context-help__trigger">
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      <span className="context-help__label">{t('article.related')}</span>
      <span className="context-help__count">{validLinks.length}</span>
    </Button>
  );

  return (
    <div className="context-help">
      {isPhone ? (
        <>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            className="context-help__trigger"
            aria-label={`${t('article.related')}, ${validLinks.length}`}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span className="context-help__label">{t('article.related')}</span>
            <span className="context-help__count" aria-hidden="true">
              {validLinks.length}
            </span>
          </Button>
          <BottomSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('article.related')}
            description={t('article.relatedSheetDescription')}
            detents={['medium', 'large']}
            className="context-help__sheet"
            returnFocusRef={triggerRef}
          >
            <PhoneArticleList links={validLinks} />
          </BottomSheet>
        </>
      ) : (
        <Popover>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent side="top" align="end" className="context-help__popover">
            <ArticleMenu links={validLinks} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
