import { Download, ExternalLink, FileText, Link2, Play, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import {
  formatReferenceDate,
  formatReferenceDuration,
  formatReferenceSize,
  isViewableReference,
  referenceLabel,
} from './referenceFormat';

export interface ReferenceTileProps {
  item: ReferenceItem;
  /** `can('entregas', 'editar') === true`, mirrored server-side by post-references DELETE. */
  canDelete: boolean;
  onOpen: (item: ReferenceItem) => void;
  onDeleteRequest: (item: ReferenceItem) => void;
}

const OVERLAY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-[12px] font-semibold text-stone-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const OVERLAY_ICON_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-stone-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

function ReferencePreview({ item }: { item: ReferenceItem }) {
  if (item.kind === 'link') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-sky-50 px-2 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
        <Link2 className="h-5 w-5" aria-hidden="true" />
        <span className="max-w-full truncate text-[11px] font-medium">
          {item.link_domain ?? 'Link'}
        </span>
      </div>
    );
  }
  if (item.file_kind === 'document') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        <FileText className="h-6 w-6" aria-hidden="true" />
        <span className="text-[11px] font-bold tracking-wide">PDF</span>
      </div>
    );
  }
  if (item.file_kind === 'video') {
    const duration = formatReferenceDuration(item.duration_seconds);
    return (
      <div className="relative h-full w-full bg-stone-900">
        {item.thumbnail_url && (
          <img
            src={sanitizeUrl(item.thumbnail_url)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-80"
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden="true" />
          </span>
        </span>
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white">
            {duration}
          </span>
        )}
      </div>
    );
  }
  return (
    <img
      src={sanitizeUrl(item.thumbnail_url ?? item.url)}
      alt=""
      loading="lazy"
      className="h-full w-full bg-stone-100 object-cover dark:bg-stone-800"
    />
  );
}

export function ReferenceTile({ item, canDelete, onOpen, onDeleteRequest }: ReferenceTileProps) {
  const label = referenceLabel(item);
  const size = item.kind === 'file' ? formatReferenceSize(item.size_bytes) : null;
  const meta = ['Cliente', formatReferenceDate(item.created_at), size]
    .filter(Boolean)
    .join(' · ');
  const externalHref = sanitizeUrl(item.kind === 'link' ? item.link_url : item.url);
  const downloadHref =
    item.kind === 'file' && item.download_url ? sanitizeUrl(item.download_url) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={`reference-tile-${item.id}`}>
      <div className="group relative aspect-square overflow-hidden rounded-xl ring-1 ring-[var(--border-color)]">
        <ReferencePreview item={item} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          {isViewableReference(item) ? (
            <button
              type="button"
              className={OVERLAY_BTN}
              onClick={() => onOpen(item)}
              aria-label={`Abrir ${label}`}
            >
              Abrir
            </button>
          ) : (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              className={OVERLAY_BTN}
              aria-label={`Abrir ${label}`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir
            </a>
          )}
          {(downloadHref || canDelete) && (
            <div className="flex items-center gap-1.5">
              {downloadHref && (
                <a
                  href={downloadHref}
                  download={item.name ?? true}
                  className={OVERLAY_ICON_BTN}
                  aria-label="Baixar"
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  className={OVERLAY_ICON_BTN}
                  onClick={() => onDeleteRequest(item)}
                  aria-label="Excluir referência"
                  title="Excluir referência"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-0.5">
        {item.kind === 'link' ? (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[12.5px] font-semibold text-[var(--text-main)] hover:underline"
            title={label}
          >
            {label}
          </a>
        ) : (
          <p className="truncate text-[12.5px] font-semibold text-[var(--text-main)]" title={label}>
            {label}
          </p>
        )}
        {item.note && (
          <p className="line-clamp-2 break-words text-[12px] text-[var(--text-muted)]">
            {item.note}
          </p>
        )}
        <p className="text-[11px] text-[var(--text-light)]">{meta}</p>
        {item.post_approval_id != null && (
          <Badge variant="warning" size="sm">
            Na correção
          </Badge>
        )}
      </div>
    </div>
  );
}
