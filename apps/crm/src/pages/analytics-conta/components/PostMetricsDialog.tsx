import type { RefObject } from 'react';
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
  return (
    <Dialog open={post !== null} onOpenChange={onOpenChange}>
      {/* z above an open Sheet (z-[9010]/[9011]), as MediaAdjustmentDialog does. */}
      <DialogContent
        className="max-h-[90vh] max-w-[720px] overflow-y-auto z-[9021]"
        overlayClassName="z-[9020]"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo?.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle>Métricas do post</DialogTitle>
            <InstagramLinkButton permalink={post?.permalink ?? null} />
          </div>
        </DialogHeader>
        {post && (
          <PostMetricsView
            post={post}
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
