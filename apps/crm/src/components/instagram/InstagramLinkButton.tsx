import { Instagram } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/utils/security';

/** True when the permalink is a safe link worth showing (sanitizeUrl never returns ''). */
export function hasInstagramLink(permalink: string | null | undefined): boolean {
  return !!permalink && sanitizeUrl(permalink) !== '#';
}

/** Small icon link that opens the post on Instagram. Renders nothing without a safe link. */
export function InstagramLinkButton({
  permalink,
  size = 32,
  shape = 'round',
  className,
}: {
  permalink: string | null;
  size?: 32 | 36;
  shape?: 'round' | 'square';
  className?: string;
}) {
  if (!hasInstagramLink(permalink)) return null;
  return (
    <a
      href={sanitizeUrl(permalink as string)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir no Instagram"
      title="Abrir no Instagram"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-[var(--border-color)] bg-[var(--surface-1)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]',
        size === 36 ? 'h-9 w-9' : 'h-8 w-8',
        shape === 'round' ? 'rounded-full' : 'rounded-lg',
        className,
      )}
    >
      <Instagram size={16} aria-hidden="true" />
    </a>
  );
}
