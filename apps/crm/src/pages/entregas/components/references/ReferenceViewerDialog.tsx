import { useState } from 'react';
import { Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import { referenceLabel } from './referenceFormat';

// Reference videos are plain R2 files (never Cloudflare Stream), so codecs the browser cannot
// decode (HEVC .mov in Chrome) fail here; the download is the way out.
export const VIDEO_PLAYBACK_ERROR = 'Não foi possível reproduzir aqui. Baixe o arquivo.';

export interface ReferenceViewerDialogProps {
  /** The image or video to show; null keeps the dialog closed. */
  item: ReferenceItem | null;
  onClose: () => void;
}

export function ReferenceViewerDialog({ item, onClose }: ReferenceViewerDialogProps) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Keyed by id so the playback-failure flag never leaks into the next item. */}
      {item && <ReferenceViewerContent key={item.id} item={item} />}
    </Dialog>
  );
}

function ReferenceViewerContent({ item }: { item: ReferenceItem }) {
  const [failed, setFailed] = useState(false);
  const label = referenceLabel(item);
  const src = sanitizeUrl(item.url);
  const downloadHref = item.download_url ? sanitizeUrl(item.download_url) : null;

  return (
    <DialogContent className="max-w-3xl">
      <div className="min-w-0 space-y-1 pr-8">
        <DialogTitle className="truncate text-[15px]">{label}</DialogTitle>
        <DialogDescription className={item.note ? 'text-[13px]' : 'sr-only'}>
          {item.note || 'Referência enviada pelo cliente'}
        </DialogDescription>
      </div>
      <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-lg bg-stone-950">
        {item.file_kind === 'video' ? (
          failed ? (
            <p role="alert" className="px-6 py-10 text-center text-[13px] text-stone-200">
              {VIDEO_PLAYBACK_ERROR}
            </p>
          ) : (
            <video
              data-testid="reference-viewer-video"
              src={src}
              poster={item.thumbnail_url ? sanitizeUrl(item.thumbnail_url) : undefined}
              controls
              playsInline
              preload="metadata"
              className="max-h-[65vh] w-full"
              onError={() => setFailed(true)}
            />
          )
        ) : (
          <img src={src} alt={label} className="max-h-[65vh] w-full object-contain" />
        )}
      </div>
      {downloadHref && (
        <div className="flex justify-end">
          <a
            href={downloadHref}
            download={item.name ?? true}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Baixar
          </a>
        </div>
      )}
    </DialogContent>
  );
}
