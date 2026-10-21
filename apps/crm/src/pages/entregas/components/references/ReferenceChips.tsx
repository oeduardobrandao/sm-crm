import { FileText, Link2, Play } from 'lucide-react';
import type { ReferenceItem } from '@/store/postReferences';
import { sanitizeUrl } from '@/utils/security';
import { isViewableReference, referenceLabel } from './referenceFormat';

const CHIP =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] py-1 pl-1 pr-2.5 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--surface-hover)]';
const THUMB =
  'relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md';

function ChipThumb({ item }: { item: ReferenceItem }) {
  if (item.kind === 'link') {
    return (
      <span className={`${THUMB} bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300`}>
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (item.file_kind === 'document') {
    return (
      <span className={`${THUMB} bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300`}>
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`${THUMB} bg-stone-900`}>
      {item.thumbnail_url && (
        <img src={sanitizeUrl(item.thumbnail_url)} alt="" className="h-full w-full object-cover" />
      )}
      {item.file_kind === 'video' && (
        <Play className="absolute h-3 w-3 text-white" fill="currentColor" aria-hidden="true" />
      )}
    </span>
  );
}

export interface ReferenceChipsProps {
  /** References whose post_approval_id is this bubble's approval. */
  references: ReferenceItem[];
  onOpen: (item: ReferenceItem) => void;
}

/** 32px thumb + name chips under a client correction bubble. */
export function ReferenceChips({ references, onOpen }: ReferenceChipsProps) {
  if (references.length === 0) return null;
  return (
    <ul aria-label="Referências anexadas" className="mt-2 flex flex-wrap gap-1.5">
      {references.map((item) => {
        const label = referenceLabel(item);
        const body = (
          <>
            <ChipThumb item={item} />
            <span className="max-w-[160px] truncate">{label}</span>
          </>
        );
        return (
          <li key={item.id} className="min-w-0">
            {isViewableReference(item) ? (
              <button type="button" className={CHIP} onClick={() => onOpen(item)} title={label}>
                {body}
              </button>
            ) : (
              <a
                className={CHIP}
                href={sanitizeUrl(item.kind === 'link' ? item.link_url : item.url)}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
              >
                {body}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
