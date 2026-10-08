import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import type { AddReferenceLinkInput } from '../../../hooks/usePostReferences';
import {
  MAX_REFERENCE_LINK_TITLE,
  MAX_REFERENCE_NOTE,
  MAX_REFERENCE_URL,
  normalizeReferenceUrl,
} from '../../../services/postReferences';
import { HubDialog } from '../../ui/HubDialog';
import { referenceErrorCode, referenceErrorMessage } from './referenceErrors';
import { REFERENCE_FIELD } from './referenceFormat';

interface ReferenceLinkFormProps {
  open: boolean;
  onClose: () => void;
  /** Resolves when the link exists (the parent closes the form); rejects with the server error. */
  onSubmit: (input: AddReferenceLinkInput) => Promise<unknown>;
}

/** Bottom sheet on phones, dialog on md+. */
export function ReferenceLinkForm({ open, onClose, onSubmit }: ReferenceLinkFormProps) {
  if (!open) return null;
  return <LinkFormBody onClose={onClose} onSubmit={onSubmit} />;
}

function LinkFormBody({ onClose, onSubmit }: Omit<ReferenceLinkFormProps, 'open'>) {
  const { t } = useTranslation('hubPosts');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { url: useId(), hint: useId(), title: useId(), note: useId() };

  const close = () => {
    if (!busy) onClose();
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!normalizeReferenceUrl(url)) {
      setError(referenceErrorMessage('invalid_url', t));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        url,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
      });
    } catch (err) {
      setError(referenceErrorMessage(referenceErrorCode(err), t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubDialog open onRequestClose={close} title={t('references.link.title', 'Adicionar link')}>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="hub-bg-card w-full self-end md:self-center md:w-[min(460px,calc(100vw-3rem))] rounded-t-2xl md:rounded-xl shadow-2xl p-5 space-y-4 max-h-[calc(100dvh-1rem)] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold hub-txt">
            {t('references.link.title', 'Adicionar link')}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('references.cancel', 'Cancelar')}
            className="hub-icon-btn p-1.5 rounded-md hub-tx3"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div>
          <label htmlFor={ids.url} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.url', 'Endereço')}
          </label>
          <input
            id={ids.url}
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_REFERENCE_URL}
            aria-describedby={ids.hint}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={REFERENCE_FIELD}
          />
          <p id={ids.hint} className="mt-1 text-[12px] hub-tx3">
            {t('references.link.urlHint', 'Vamos completar com https:// se faltar.')}
          </p>
        </div>
        <div>
          <label htmlFor={ids.title} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.linkTitle', 'Título (opcional)')}
          </label>
          <input
            id={ids.title}
            type="text"
            maxLength={MAX_REFERENCE_LINK_TITLE}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={REFERENCE_FIELD}
          />
        </div>
        <div>
          <label htmlFor={ids.note} className="block text-[12.5px] font-semibold hub-tx2 mb-1">
            {t('references.link.note', 'O que a equipe deve ver aqui? (opcional)')}
          </label>
          <textarea
            id={ids.note}
            maxLength={MAX_REFERENCE_NOTE}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${REFERENCE_FIELD} resize-none`}
          />
        </div>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-rose-700 dark:text-rose-300">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2.5 min-h-[44px] rounded-[4px] hub-btn-secondary text-[13px] font-semibold"
          >
            {t('references.cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-[4px] hub-btn-primary text-[13px] font-semibold disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {t('references.link.submit', 'Adicionar link')}
          </button>
        </div>
      </form>
    </HubDialog>
  );
}
