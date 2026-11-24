import { useEffect, useState, type RefObject } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InstagramLinkButton } from '@/components/instagram/InstagramLinkButton';
import type { PostAnalytics } from '../../../services/analytics';
import type { RateDistributions } from '../../../lib/ig-rates';
import { PostMetricsView } from './PostMetricsView';

/** Desktop pop-up with the Instagram-style post insights. Phones use PostDetailSheet. */
export function PostMetricsDialog({
  post,
  onOpenChange,
  clientId,
  dists,
  commentsEnabled,
  returnFocusTo,
}: {
  post: PostAnalytics | null;
  onOpenChange: (open: boolean) => void;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  // Keeps the last post while the dialog animates out, so the body doesn't vanish on close.
  const [shown, setShown] = useState<PostAnalytics | null>(post);
  useEffect(() => {
    if (post) setShown(post);
  }, [post]);
  const p = post ?? shown;

  return (
    <Dialog open={post !== null} onOpenChange={onOpenChange}>
      {/* Default Dialog z on purpose: the Comentários tab's menu, delete confirmation and idea
          modal portal at the same layer and stack above this pop-up. A "Ver mais" drawer under
          it steps down instead (AnalyticsContaPage). */}
      <DialogContent
        className="max-w-[720px]"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo?.current?.focus();
        }}
      >
        <DialogHeader>
          {/* pr-8 keeps the Instagram button clear of the built-in close X. */}
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle>Métricas do post</DialogTitle>
            <InstagramLinkButton permalink={p?.permalink ?? null} />
          </div>
        </DialogHeader>
        {p && (
          <PostMetricsView
            post={p}
            clientId={clientId}
            dists={dists}
            commentsEnabled={commentsEnabled}
            variant="dialog"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
