import { useQuery } from '@tanstack/react-query';
import { resolveInlineImageUrls } from '../../lib/inline-image';
import { cn } from '../../lib/utils';

/** Miniatura 16:9 da imagem da primeira página (cinza quando não há imagem). */
export function PageThumb({
  imageKey,
  className,
}: {
  imageKey: string | null;
  className?: string;
}) {
  const { data: url } = useQuery({
    queryKey: ['admin', 'popup-thumb', imageKey],
    queryFn: () => resolveInlineImageUrls([imageKey!]).then((m) => m[imageKey!] ?? ''),
    enabled: Boolean(imageKey),
    staleTime: 30 * 60 * 1000,
  });
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 overflow-hidden rounded-[8px] bg-foreground/[0.1]', className)}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}
