import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { PostReferencesState, UploadEntry } from '../../hooks/usePostReferences';
import type { MaterialItem } from '../../services/materialRequests';
import type { ReferenceItem } from '../../types/postReferences';
import { ReferencePicker } from '../posts/references/ReferencePicker';
import { UploadRow } from '../posts/references/ReferenceRow';
import { ReferenceOpen, ReferenceThumb } from '../posts/references/ReferenceTiles';
import {
  formatMegabytes,
  formatReferenceWhen,
  referenceTitle,
} from '../posts/references/referenceFormat';

interface MaterialItemRowProps {
  item: MaterialItem;
  /** Files and links already attached to this item. */
  files: ReferenceItem[];
  /** This item's uploads in flight or failed. */
  uploads: UploadEntry[];
  done: boolean;
  refs: PostReferencesState;
  /** At the post's 10-reference cap. */
  disabled: boolean;
  onAdded: (item: ReferenceItem) => void;
  onOverlayChange: (open: boolean) => void;
}

/** One requested item: check circle, label, detail, its files, and "Enviar". */
export function MaterialItemRow({
  item,
  files,
  uploads,
  done,
  refs,
  disabled,
  onAdded,
  onOverlayChange,
}: MaterialItemRowProps) {
  const { t, i18n } = useTranslation('hubMaterial');
  const { t: tPosts } = useTranslation('hubPosts');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  return (
    <li className="flex flex-col gap-2.5 p-3 border-t hub-border first:border-t-0">
      <div className="flex items-start gap-3">
        {done ? (
          <span
            aria-hidden="true"
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--hub-txt)', color: 'var(--hub-card)' }}
          >
            <Check size={13} strokeWidth={2.5} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="box-border h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px]"
            style={{ borderColor: 'var(--hub-bd2)' }}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[14px] md:text-[13px] font-semibold hub-txt break-words">
            <span className="sr-only">{done ? t('itemEnviado') : t('itemPendente')}: </span>
            {item.label}
          </span>
          {item.detail && (
            <span className="text-[13px] md:text-[12.5px] leading-[1.4] hub-tx2 break-words">
              {item.detail}
            </span>
          )}
        </div>
        <ReferencePicker
          refs={refs}
          variant="item"
          materialItemId={item.id}
          label={t('enviar')}
          ariaLabel={t('dialogo.enviarItem', { label: item.label })}
          disabled={disabled}
          onAdded={onAdded}
          onOverlayChange={onOverlayChange}
        />
      </div>
      {files.length > 0 && (
        <ul
          aria-label={t('dialogo.arquivosDoItem', { label: item.label })}
          className="ml-[34px] flex flex-col gap-1.5"
        >
          {files.map((file) => {
            const title = referenceTitle(file);
            const meta = [
              tPosts('references.you', 'Você'),
              formatReferenceWhen(file.created_at, locale, tPosts),
              file.kind === 'file' && file.size_bytes != null
                ? formatMegabytes(file.size_bytes, locale)
                : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={file.id}>
                <ReferenceOpen
                  item={file}
                  label={tPosts('references.open', 'Abrir {{name}}', { name: title })}
                  className="flex items-center gap-2.5 rounded-[10px] hub-bg-soft p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)]"
                >
                  <ReferenceThumb item={file} size={40} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-semibold hub-txt">{title}</span>
                    <span className="text-[12px] hub-tx3">{meta}</span>
                  </span>
                </ReferenceOpen>
              </li>
            );
          })}
        </ul>
      )}
      {uploads.length > 0 && (
        <ul
          aria-label={tPosts('references.uploadsLabel', 'Envios em andamento')}
          className="ml-[34px]"
        >
          {uploads.map((entry) => (
            <UploadRow
              key={entry.localId}
              entry={entry}
              onCancel={refs.cancelUpload}
              onRetry={refs.retryUpload}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
