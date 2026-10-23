import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { HubDialog } from '../../ui/HubDialog';

interface Props {
  open: boolean;
  /** Where the note will land, e.g. "Comentário em 0:42". */
  title: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  /** Tells the parent a modal is up, so it can pause the carousel and video. */
  onOverlayChange: (open: boolean) => void;
}

const MAX_NOTE_LENGTH = 2000;

/** Bottom sheet on phones, centred card on md+. Keeps the text when sending fails. */
export function MediaNoteComposer({ open, title, onSubmit, onCancel, onOverlayChange }: Props) {
  const { t } = useTranslation('hubPosts');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const onOverlayChangeRef = useRef(onOverlayChange);
  onOverlayChangeRef.current = onOverlayChange;

  useUnsavedWork(open && (body.trim() !== '' || sending));

  useEffect(() => {
    if (!open) return;
    onOverlayChangeRef.current(true);
    return () => onOverlayChangeRef.current(false);
  }, [open]);

  // A closed composer starts blank next time.
  useEffect(() => {
    if (open) return;
    setBody('');
    setError(false);
  }, [open]);

  async function handleSend() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(false);
    try {
      await onSubmit(text);
      setBody('');
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <HubDialog
      open={open}
      title={title}
      onRequestClose={(reason) => {
        if (sending) return;
        // A stray tap on the scrim must not throw away what the client typed.
        if (reason === 'outside' && body.trim() !== '') return;
        onCancel();
      }}
    >
      <div className="hub-bg-card hub-txt w-full self-end rounded-t-2xl p-4 md:max-w-md md:self-center md:rounded-2xl">
        <p aria-hidden="true" className="mb-2 text-[13px] font-semibold">
          {title}
        </p>
        <textarea
          aria-label={title}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={t('mediaNotes.placeholder')}
          rows={4}
          className="hub-focus-accent hub-border hub-bg-card hub-txt min-h-[96px] w-full resize-none rounded border px-3 py-2 text-[16px] placeholder:text-[var(--hub-tx3)] focus:outline-none"
        />
        {error && (
          <p role="alert" className="mt-1.5 text-[12px] text-rose-700">
            {t('mediaNotes.sendError')}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="hub-btn-secondary min-h-[44px] rounded px-4 text-[13px] font-semibold disabled:opacity-50"
          >
            {t('mediaNotes.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || body.trim() === ''}
            className="hub-btn-primary min-h-[44px] rounded px-4 text-[13px] font-semibold disabled:opacity-50"
          >
            {t('mediaNotes.send')}
          </button>
        </div>
      </div>
    </HubDialog>
  );
}
