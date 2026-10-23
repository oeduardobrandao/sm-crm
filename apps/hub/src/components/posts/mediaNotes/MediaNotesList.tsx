import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { pinNumbers } from '@mesaas/ui/mediaPins/geometry';
import { StatusPill } from '../../StatusPill';
import { anchorLabel } from '../../../lib/mediaNotes';
import type { HubMediaNote } from '../../../types';

interface Props {
  notes: HubMediaNote[];
  canReply: boolean;
  onJump: (note: HubMediaNote) => void;
  onReply: (noteId: number, body: string) => Promise<void>;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "há 3 horas" / "3 hours ago"; no date-fns in the Hub bundle, Intl does it.
 * Under a minute (or a clock-skewed future timestamp) reads as "agora". */
function timeAgo(iso: string, lang: string, justNow: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds > -60) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(-1, 'minute');
}

function ReplyField({ noteId, onReply }: { noteId: number; onReply: Props['onReply'] }) {
  const { t } = useTranslation('hubPosts');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  useUnsavedWork(text.trim() !== '' || sending);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(false);
    try {
      await onReply(noteId, body);
      setText('');
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        aria-label={t('mediaNotes.reply')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder={t('mediaNotes.reply')}
        className="hub-focus-accent hub-border hub-bg-card hub-txt min-h-[60px] w-full resize-none rounded border px-3 py-2 text-[16px] placeholder:text-[var(--hub-tx3)] focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-300">
          {t('mediaNotes.sendError')}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={send}
          disabled={sending || text.trim() === ''}
          className="hub-btn-primary min-h-[36px] rounded px-4 text-[12px] font-semibold disabled:opacity-50"
        >
          {t('mediaNotes.reply')}
        </button>
      </div>
    </div>
  );
}

export function MediaNotesList({ notes, canReply, onJump, onReply }: Props) {
  const { t, i18n } = useTranslation('hubPosts');
  const lang = i18n.language === 'en' ? 'en' : 'pt-BR';
  const numbers = useMemo(() => pinNumbers(notes, (n) => n.link_id), [notes]);

  return (
    <ul className="space-y-3">
      {notes.map((n) => {
        const open = n.status === 'open';
        return (
          <li key={n.id} className="hub-card rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onJump(n)}
                className="hub-bg-soft hub-txt min-h-[32px] rounded-full px-3 text-[12px] font-semibold"
              >
                {anchorLabel(n, t, numbers.get(n.id))}
              </button>
              <StatusPill tone={open ? 'accent' : 'neutral'} semantic={open ? 'wait' : 'ok'}>
                {open ? t('mediaNotes.statusOpen') : t('mediaNotes.statusResolved')}
              </StatusPill>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] hub-txt">{n.body}</p>
            <p className="mt-0.5 text-[12px] hub-tx3">
              {timeAgo(n.created_at, lang, t('mediaNotes.justNow'))}
            </p>
            {n.replies.length > 0 && (
              <ul className="mt-2 space-y-2 border-l-2 pl-3 hub-border">
                {n.replies.map((r) => (
                  <li key={r.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-semibold hub-tx3">
                        {r.author === 'team'
                          ? (r.author_name ?? t('mediaNotes.team'))
                          : t('history.actor.you')}
                      </span>
                      <span className="text-[12px] hub-tx3">
                        {timeAgo(r.created_at, lang, t('mediaNotes.justNow'))}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[12px] hub-tx2">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {canReply && <ReplyField noteId={n.id} onReply={onReply} />}
          </li>
        );
      })}
    </ul>
  );
}
