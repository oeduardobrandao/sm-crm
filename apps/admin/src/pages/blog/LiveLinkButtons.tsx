import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { liveUrl } from './blog-view';

/** Toolbar pair for a live post: open it on the site (tagged `?ref=admin`) and copy the clean
 * public URL. */
export function LiveLinkButtons({ slug }: { slug: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(liveUrl(slug));
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar o link');
    }
  };
  return (
    <>
      <Button variant="outline" asChild>
        <a href={liveUrl(slug, { fromAdmin: true })} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden="true" />
          Abrir no site
        </a>
      </Button>
      <Button variant="outline" size="icon" aria-label="Copiar link" onClick={() => void copy()}>
        <LinkIcon aria-hidden="true" />
      </Button>
    </>
  );
}

/** Row icon that opens the live post without selecting the row. */
export function LiveRowLink({ slug, title }: { slug: string; title: string }) {
  return (
    <a
      href={liveUrl(slug, { fromAdmin: true })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Abrir ${title} no site`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex size-7 shrink-0 items-center justify-center self-start rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      <ExternalLink size={15} aria-hidden="true" />
    </a>
  );
}
