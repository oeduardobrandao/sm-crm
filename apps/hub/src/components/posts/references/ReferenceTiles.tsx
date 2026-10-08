import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Link2, Play } from 'lucide-react';
import { sanitizeExternalUrl } from '../../../lib/security';
import type { ReferenceItem } from '../../../types/postReferences';
import { formatDuration, referenceTitle } from './referenceFormat';

/** Square preview: image thumb, video poster with play and duration, PDF tile, link tile. */
export function ReferenceThumb({ item, size }: { item: ReferenceItem; size: number }) {
  const box = { width: size, height: size };
  const big = size >= 56;
  if (item.kind === 'link' || item.file_kind === 'document') {
    const Icon = item.kind === 'link' ? Link2 : FileText;
    return (
      <span
        style={box}
        className="shrink-0 rounded-[6px] hub-bg-soft hub-tx2 flex flex-col items-center justify-center gap-0.5"
      >
        <Icon size={big ? 20 : 13} aria-hidden="true" />
        {big && item.kind === 'file' && (
          <span className="text-[10px] font-semibold tracking-[0.04em]">PDF</span>
        )}
      </span>
    );
  }
  const src = item.thumbnail_url ?? (item.file_kind === 'image' ? item.url : null);
  return (
    <span style={box} className="relative block shrink-0 rounded-[6px] overflow-hidden hub-bg-soft">
      {item.blur_data_url?.startsWith('data:image/') && (
        <img
          src={item.blur_data_url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {src && (
        <img src={src} alt="" loading="lazy" className="relative w-full h-full object-cover" />
      )}
      {item.file_kind === 'video' && (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className={`${big ? 'w-6 h-6' : 'w-4 h-4'} rounded-full bg-black/55 flex items-center justify-center`}
            >
              <Play
                size={big ? 12 : 8}
                className="text-white fill-white ml-px"
                aria-hidden="true"
              />
            </span>
          </span>
          {big && item.duration_seconds != null && (
            <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/65 px-1 text-[10px] leading-[14px] text-white tabular-nums">
              {formatDuration(item.duration_seconds)}
            </span>
          )}
        </>
      )}
    </span>
  );
}

interface ReferenceOpenProps {
  item: ReferenceItem;
  /** Image/video viewer. Without it, files open in a new tab like PDFs. */
  onOpen?: (item: ReferenceItem) => void;
  label: string;
  className?: string;
  /** A second, mouse-only target for the same item (the row thumb): hidden from AT and Tab. */
  decorative?: boolean;
  children: ReactNode;
}

/** Links and PDFs open in a new tab (sanitized URL); images and videos open the viewer. */
export function ReferenceOpen({
  item,
  onOpen,
  label,
  className,
  decorative = false,
  children,
}: ReferenceOpenProps) {
  const a11y = decorative ? { 'aria-hidden': true, tabIndex: -1 } : { 'aria-label': label };
  if (item.kind === 'link' || item.file_kind === 'document' || !onOpen) {
    const href = item.kind === 'link' ? item.link_url : item.url;
    return (
      <a
        href={sanitizeExternalUrl(href)}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        {...a11y}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(item)} className={className} {...a11y}>
      {children}
    </button>
  );
}

/** 72px tiles under a client correction in the history. */
export function ReferenceTiles({
  items,
  onOpen,
}: {
  items: ReferenceItem[];
  onOpen?: (item: ReferenceItem) => void;
}) {
  const { t } = useTranslation('hubPosts');
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <ReferenceOpen
            item={item}
            onOpen={onOpen}
            label={t('references.open', 'Abrir {{name}}', { name: referenceTitle(item) })}
            className="block rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)]"
          >
            <ReferenceThumb item={item} size={72} />
          </ReferenceOpen>
        </li>
      ))}
    </ul>
  );
}
