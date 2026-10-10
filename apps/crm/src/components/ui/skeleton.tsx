import { cn } from '@/lib/utils';

/**
 * One loading bar. A tint of the text colour rather than the brand yellow, so it reads on the
 * page background and inside a `.card` in both themes, and it only pulses when the user has not
 * asked for reduced motion. Compositions shaped like real content live in
 * `components/ui/skeletons.tsx`.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('motion-safe:animate-pulse rounded-md bg-foreground/[0.07]', className)}
      {...props}
    />
  );
}

export { Skeleton };
