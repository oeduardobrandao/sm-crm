import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { PostReferencesState, UploadEntry } from '../../hooks/usePostReferences';
import type { MaterialItem } from '../../services/materialRequests';
import type { ReferenceItem } from '../../types/postReferences';
import { ReferencePicker } from '../posts/references/ReferencePicker';
import { ReferenceRow, UploadRow } from '../posts/references/ReferenceRow';

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
  /** The request closed: item files are read-only (no remove, no note). */
  closed?: boolean;
  onAdded: (item: ReferenceItem) => void;
  /** Image/video viewer for an item file. */
  onOpenFile: (item: ReferenceItem) => void;
  onRemoveFile: (id: number) => Promise<void>;
  onNoteDirtyChange: (id: number, dirty: boolean) => void;
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
  closed = false,
  onAdded,
  onOpenFile,
  onRemoveFile,
  onNoteDirtyChange,
  onOverlayChange,
}: MaterialItemRowProps) {
  const { t } = useTranslation('hubMaterial');
  const { t: tPosts } = useTranslation('hubPosts');

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
        // Same row as the Referências tab: remove and note only where the server says can_remove.
        <ul
          aria-label={t('dialogo.arquivosDoItem', { label: item.label })}
          className="ml-[34px] divide-y divide-[var(--hub-bd)]"
        >
          {files.map((file) => (
            <ReferenceRow
              key={file.id}
              // Closed: the server locks item files (can_remove false), even before the refetch.
              item={closed && file.can_remove ? { ...file, can_remove: false } : file}
              fresh={false}
              onOpen={onOpenFile}
              onSaveNote={refs.updateNote}
              onRemove={onRemoveFile}
              onDirtyChange={onNoteDirtyChange}
              onOverlayChange={onOverlayChange}
            />
          ))}
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
