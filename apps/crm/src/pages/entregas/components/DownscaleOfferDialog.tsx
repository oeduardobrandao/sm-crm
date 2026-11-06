import { Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DownscalePlan, DownscaleSupport } from '../media-editor/downscalePlan';
import type { OversizeReason } from '../media-editor/oversize';

export interface DownscaleOfferItem {
  key: string;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  plan: DownscalePlan | null;
  reasons: OversizeReason[];
  /** null while inspecting. */
  support: DownscaleSupport | null;
  /** > 2 GB. */
  overClientCap: boolean;
}

const mb = (bytes: number) => Math.round(bytes / 2 ** 20);

export function DownscaleOfferDialog({
  open,
  items,
  onReduce,
  onSendOriginal,
  onDismiss,
}: {
  open: boolean;
  items: DownscaleOfferItem[];
  onReduce: () => void;
  onSendOriginal: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('posts');
  const inspecting = items.some((i) => i.support === null);
  const canReduce =
    !inspecting && items.some((i) => i.plan !== null && i.support && i.support.engine !== 'none');
  const originalBlocked = items.length > 0 && items.every((i) => i.overClientCap);
  const showSlowEngine = items.some((i) => i.support?.engine === 'ffmpeg');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('mediaGallery.downscale.offerTitle', { count: items.length })}
          </DialogTitle>
        </DialogHeader>

        <ul className="divide-y rounded-[10px] border">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-3 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Video className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('mediaGallery.downscale.dimsSize', {
                    w: item.width,
                    h: item.height,
                    mb: mb(item.sizeBytes),
                  })}
                  {item.plan && (
                    <>
                      {' → '}
                      <strong className="font-semibold text-foreground">
                        {item.plan.width}×{item.plan.height}
                      </strong>
                    </>
                  )}
                </p>
                {item.reasons.map((reason) => (
                  <p key={reason} className="text-xs text-amber-900 dark:text-amber-100">
                    {t(
                      reason === 'width'
                        ? 'mediaGallery.downscale.reasonWidth'
                        : 'mediaGallery.downscale.reasonSize',
                    )}
                  </p>
                ))}
                {item.plan === null && (
                  <p className="text-xs text-muted-foreground">
                    {t('mediaGallery.downscale.tooLong')}
                  </p>
                )}
                {item.support?.engine === 'none' && (
                  <p className="text-xs text-muted-foreground">
                    {t('mediaGallery.downscale.unsupported')}
                  </p>
                )}
                {item.support?.hdr && (
                  <p className="text-xs text-muted-foreground">{t('mediaGallery.downscale.hdr')}</p>
                )}
                {item.overClientCap && (
                  <p className="text-xs text-muted-foreground">
                    {t('mediaGallery.downscale.overClientCap')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {showSlowEngine && (
          <p className="text-xs text-muted-foreground">{t('mediaGallery.downscale.slowEngine')}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onSendOriginal} disabled={originalBlocked}>
            {t('mediaGallery.downscale.offerOriginal')}
          </Button>
          <Button onClick={onReduce} disabled={!canReduce}>
            {t('mediaGallery.downscale.offerReduce')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
