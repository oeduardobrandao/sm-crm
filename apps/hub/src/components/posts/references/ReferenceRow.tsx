import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Film, ImageIcon, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { UploadEntry } from '../../../hooks/usePostReferences';
import { MAX_REFERENCE_NOTE } from '../../../services/postReferences';
import type { ReferenceErrorCode, ReferenceItem } from '../../../types/postReferences';
import { referenceErrorCode, referenceErrorMessage } from './referenceErrors';
import {
  REFERENCE_FIELD,
  formatMegabytes,
  formatReferenceWhen,
  referenceTitle,
} from './referenceFormat';
import { ReferenceOpen, ReferenceThumb } from './ReferenceTiles';

const ICON_BUTTON =
  'w-11 h-11 -mr-2 -mt-2 shrink-0 rounded-full flex items-center justify-center hub-tx3 hover:bg-[var(--hub-soft)] disabled:opacity-50';
const SMALL_BUTTON = 'rounded-[4px] px-3 py-2 min-h-[40px] text-[12.5px] font-semibold';

interface ReferenceRowProps {
  item: ReferenceItem;
  /** Uploaded by this card just now: the note field starts open. */
  fresh: boolean;
  onOpen: (item: ReferenceItem) => void;
  onSaveNote: (id: number, note: string) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  /** An open note editor whose text differs from the saved note. */
  onDirtyChange?: (id: number, dirty: boolean) => void;
}

export function ReferenceRow({
  item,
  fresh,
  onOpen,
  onSaveNote,
  onRemove,
  onDirtyChange,
}: ReferenceRowProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [editing, setEditing] = useState(fresh && item.can_remove && !item.note);
  const [draft, setDraft] = useState(item.note ?? '');
  const [busy, setBusy] = useState<'note' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const dirty = editing && draft.trim() !== (item.note ?? '').trim();
  useEffect(() => {
    if (!dirty || !onDirtyChange) return;
    onDirtyChange(item.id, true);
    return () => onDirtyChange(item.id, false);
  }, [dirty, item.id, onDirtyChange]);
  const title = referenceTitle(item);
  const openLabel = t('references.open', 'Abrir {{name}}', { name: title });
  const meta = [
    t('references.you', 'Você'),
    formatReferenceWhen(item.created_at, locale, t),
    item.kind === 'file' && item.size_bytes != null
      ? formatMegabytes(item.size_bytes, locale)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function saveNote() {
    if (busy) return;
    setBusy('note');
    setError(null);
    try {
      await onSaveNote(item.id, draft);
      setEditing(false);
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(t('references.removeConfirm', 'Remover referência?'))) return;
    setBusy('remove');
    setError(null);
    try {
      await onRemove(item.id);
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
      setBusy(null);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <ReferenceOpen
          item={item}
          onOpen={onOpen}
          label={openLabel}
          decorative
          className="shrink-0 rounded-[6px]"
        >
          <ReferenceThumb item={item} size={56} />
        </ReferenceOpen>
        <div className="min-w-0 flex-1 space-y-0.5">
          <ReferenceOpen
            item={item}
            onOpen={onOpen}
            label={openLabel}
            className="block text-left text-[13.5px] font-semibold hub-txt break-words line-clamp-2 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hub-acc)] rounded-sm"
          >
            {title}
          </ReferenceOpen>
          {item.kind === 'link' && item.link_title && item.link_domain && (
            <p className="text-[12px] hub-tx3 truncate">{item.link_domain}</p>
          )}
          {item.note && !editing && (
            <p className="text-[13px] hub-tx2 whitespace-pre-wrap break-words">{item.note}</p>
          )}
          <p className="text-[12px] hub-tx3">{meta}</p>
          {item.can_remove && !editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(item.note ?? '');
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 min-h-[32px] text-[12px] font-semibold"
              style={{ color: 'var(--hub-acc)' }}
            >
              <Pencil size={12} aria-hidden="true" />
              {item.note
                ? t('references.editNote', 'Editar nota')
                : t('references.addNote', 'Adicionar nota')}
            </button>
          )}
        </div>
        {item.can_remove && (
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            aria-label={t('references.remove', 'Remover referência')}
            className={ICON_BUTTON}
          >
            {busy === 'remove' ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={16} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2 sm:pl-[68px]">
          <label htmlFor={noteId} className="block text-[12.5px] font-semibold hub-tx2">
            {t('references.noteLabel', 'O que mudar com isso? (opcional)')}
          </label>
          <textarea
            id={noteId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_REFERENCE_NOTE}
            rows={2}
            className={`${REFERENCE_FIELD} resize-none`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(item.note ?? '');
                setError(null);
              }}
              className={`hub-btn-secondary ${SMALL_BUTTON}`}
            >
              {t('references.cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={busy !== null}
              className={`hub-btn-primary ${SMALL_BUTTON} disabled:opacity-50`}
            >
              {busy === 'note'
                ? t('references.savingNote', 'Salvando...')
                : t('references.saveNote', 'Salvar nota')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </li>
  );
}

/** Retrying cannot fix these: the file, the post or the quota has to change first. */
const NOT_RETRYABLE: ReadonlySet<ReferenceErrorCode> = new Set<ReferenceErrorCode>([
  'unsupported_type',
  'too_large',
  'reference_limit',
  'post_not_pending',
  'quota_exceeded',
]);

interface UploadRowProps {
  entry: UploadEntry;
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
}

export function UploadRow({ entry, onCancel, onRetry }: UploadRowProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const uploading = entry.status === 'uploading';
  const pct = entry.total > 0 ? Math.min(100, Math.round((entry.loaded / entry.total) * 100)) : 0;
  const Icon =
    entry.fileKind === 'video' ? Film : entry.fileKind === 'image' ? ImageIcon : FileText;
  const code = entry.error ?? 'internal';
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="w-14 h-14 shrink-0 rounded-[6px] hub-bg-soft hub-tx3 flex items-center justify-center">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[13.5px] font-semibold hub-txt truncate">{entry.name}</p>
          {uploading ? (
            <>
              <div
                role="progressbar"
                aria-label={t('references.progressLabel', 'Envio de {{name}}', {
                  name: entry.name,
                })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-1.5 rounded-full hub-bg-soft overflow-hidden"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${pct}%`, background: 'var(--hub-acc)' }}
                />
              </div>
              <p className="text-[12px] hub-tx3">
                {t(
                  'references.uploading',
                  'Enviando {{loaded}} de {{total}}. Não feche esta tela.',
                  {
                    loaded: formatMegabytes(entry.loaded, locale),
                    total: formatMegabytes(entry.total, locale),
                  },
                )}
              </p>
            </>
          ) : (
            <>
              <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-300">
                {referenceErrorMessage(code, t, {
                  fileKind: entry.fileKind,
                  sizeBytes: entry.total,
                })}
              </p>
              <div className="flex gap-2 pt-1">
                {!NOT_RETRYABLE.has(code) && (
                  <button
                    type="button"
                    onClick={() => onRetry(entry.localId)}
                    className={`hub-btn-secondary ${SMALL_BUTTON}`}
                  >
                    {t('references.retryUpload', 'Tentar novamente')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onCancel(entry.localId)}
                  className={`${SMALL_BUTTON} hub-tx2 hover:bg-[var(--hub-soft)]`}
                >
                  {t('references.discardUpload', 'Descartar')}
                </button>
              </div>
            </>
          )}
        </div>
        {uploading && (
          <button
            type="button"
            onClick={() => onCancel(entry.localId)}
            aria-label={t('references.cancelUpload', 'Cancelar envio de {{name}}', {
              name: entry.name,
            })}
            className={ICON_BUTTON}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
