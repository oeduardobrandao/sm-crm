import { useState } from 'react';
import { CheckCircle2, RotateCcw, Send } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { toast } from 'sonner';
import type { Membro } from '@/store';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostMedia } from '@/store/posts';
import { resolveAuthorName } from '../PostCommentSummary';
import { noteAnchorLabel } from './conversationItems';

export interface MediaNoteAuthors {
  clientName?: string | null;
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string | null }[];
}

export function authorLabel(
  kind: 'client' | 'team',
  userId: string | null,
  { clientName, membros, workspaceUsers }: MediaNoteAuthors,
): string {
  if (kind === 'client') return clientName || 'Cliente';
  return userId ? resolveAuthorName(userId, membros, workspaceUsers) : 'Equipe';
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MediaNoteCardProps extends MediaNoteAuthors {
  note: MediaNote;
  /** Every client note of the post: pins are numbered per slide against this list. */
  allNotes: MediaNote[];
  media: PostMedia[];
  onReply: (noteId: number, body: string) => Promise<void>;
  onStatus: (noteIds: number[], status: 'open' | 'resolved') => Promise<void>;
  onSelectMedia?: (linkId: number) => void;
}

/** A client note pinned to the media: anchor chip, thread, client-facing reply and resolve. */
export function MediaNoteCard({
  note,
  allNotes,
  media,
  onReply,
  onStatus,
  onSelectMedia,
  ...authors
}: MediaNoteCardProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  useUnsavedWork(text.trim() !== '');

  const anchor = noteAnchorLabel(note, allNotes, media);
  const linkId = note.current_link_id;
  const canJump = linkId != null && !note.is_previous_version && onSelectMedia != null;
  const resolved = note.status === 'resolved';

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onReply(note.id, body);
      setText('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar resposta');
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async () => {
    setChanging(true);
    try {
      await onStatus([note.id], resolved ? 'open' : 'resolved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar o comentário');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div
      className={`media-note-card${resolved ? ' media-note-card--resolved' : ''}`}
      data-note-id={note.id}
    >
      <div className="media-note-card__head">
        {canJump ? (
          <button
            type="button"
            className="media-note-card__anchor"
            onClick={() => onSelectMedia(linkId)}
          >
            {anchor}
          </button>
        ) : (
          <span className="media-note-card__anchor media-note-card__anchor--static">{anchor}</span>
        )}
        <span
          className={`media-note-card__status media-note-card__status--${resolved ? 'resolved' : 'open'}`}
        >
          {resolved ? 'Resolvido' : 'Em aberto'}
        </span>
      </div>
      <div className="media-note-card__meta">
        <strong>{authorLabel(note.author_kind, note.author_user_id, authors)}</strong>
        <span>{formatWhen(note.created_at)}</span>
      </div>
      <p className="media-note-card__body">{note.body}</p>

      {note.replies.length > 0 && (
        <ul className="media-note-card__replies">
          {note.replies.map((r) => (
            <li
              key={r.id}
              className={`media-note-card__reply${r.author_kind === 'team' ? ' media-note-card__reply--team' : ''}`}
            >
              <span className="media-note-card__meta">
                <strong>{authorLabel(r.author_kind, r.author_user_id, authors)}</strong>
                <span>{formatWhen(r.created_at)}</span>
              </span>
              <p className="media-note-card__body">{r.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="media-note-card__reply-row">
        <input
          className="drawer-input"
          placeholder="Responder ao cliente…"
          aria-label={`Responder ao cliente sobre ${anchor}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="drawer-reply-btn"
          aria-label="Enviar resposta"
          disabled={sending || !text.trim()}
          onClick={() => void send()}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        className="media-note-card__toggle"
        disabled={changing}
        onClick={() => void toggleStatus()}
      >
        {resolved ? (
          <>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reabrir
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Marcar como resolvido
          </>
        )}
      </button>
    </div>
  );
}
