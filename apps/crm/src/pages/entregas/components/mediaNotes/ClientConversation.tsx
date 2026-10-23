import { useMemo, useState, type ReactNode } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { Membro } from '@/store';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval, PostMedia } from '@/store/posts';
import { MediaNoteCard } from './MediaNoteCard';
import { buildConversationItems } from './conversationItems';

type Filter = 'tudo' | 'abertas' | 'midia';

export interface MediaNotesBinding {
  notes: MediaNote[];
  onReply: (noteId: number, body: string) => Promise<void>;
  onStatus: (noteIds: number[], status: 'open' | 'resolved') => Promise<void>;
  /** Selects a media item in the preview (the anchor chip). */
  onSelectMedia?: (linkId: number) => void;
  /** The client's name, for the author line of their notes. */
  clientName?: string | null;
  /** Called after the media area changes notes (resolve prompt, internal note). */
  onChanged?: () => void | Promise<void>;
}

export interface ClientConversationProps {
  approvals: PostApproval[];
  notes: MediaNote[];
  media: PostMedia[];
  workspaceUsers: { id: string; nome: string; avatar_url: string | null }[];
  membros: Membro[];
  clientName?: string | null;
  replyText: string;
  sendingReply: boolean;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  onNoteReply: (noteId: number, body: string) => Promise<void>;
  onNoteStatus: (noteIds: number[], status: 'open' | 'resolved') => Promise<void>;
  onSelectMedia?: (linkId: number) => void;
  /** How an approval entry renders (the desktop bubble, the phone bubble). */
  renderApproval?: (approval: PostApproval) => ReactNode;
  /** `none`: the host draws its own reply composer (the phone bottom bar). */
  composer?: 'inline' | 'none';
  /**
   * The host's own heading for the thread, in place of the "Comentários" label. With it the
   * thread is a `<section>` labelled by `headerId` and shows even while it is empty.
   */
  header?: ReactNode;
  headerId?: string;
  className?: string;
}

function DefaultApproval({ approval }: { approval: PostApproval }) {
  return approval.comentario ? <p className="approval-bubble-text">{approval.comentario}</p> : null;
}

/**
 * The post's conversation with the client: approvals (messages, corrections, approvals)
 * interleaved with the client's notes pinned to the media, plus the generic reply input.
 */
export function ClientConversation({
  approvals,
  notes,
  media,
  workspaceUsers,
  membros,
  clientName,
  replyText,
  sendingReply,
  onReplyChange,
  onReplySend,
  onNoteReply,
  onNoteStatus,
  onSelectMedia,
  renderApproval,
  composer = 'inline',
  header,
  headerId,
  className,
}: ClientConversationProps) {
  const [filter, setFilter] = useState<Filter>('tudo');

  const items = useMemo(
    () => buildConversationItems(approvals, notes, media),
    [approvals, notes, media],
  );
  const clientNotes = useMemo(() => notes.filter((n) => n.visibility === 'client'), [notes]);
  const openCount = clientNotes.filter((n) => n.status === 'open').length;

  const visible = items.filter((item) => {
    if (filter === 'tudo') return true;
    if (item.kind !== 'note') return false;
    return filter === 'midia' || item.note.status === 'open';
  });

  const Thread = header ? 'section' : 'div';

  return (
    <div className={`client-conversation${className ? ` ${className}` : ''}`}>
      {(header || items.length > 0) && (
        <Thread className="drawer-approval-thread" aria-labelledby={header ? headerId : undefined}>
          {header ?? (
            <div className="drawer-thread-label">
              <MessageSquare className="h-3.5 w-3.5" /> Comentários
            </div>
          )}

          {clientNotes.length > 0 && (
            <div
              className="client-conversation__filters"
              role="group"
              aria-label="Filtrar conversa"
            >
              {(
                [
                  ['tudo', 'Tudo'],
                  ['abertas', `Em aberto (${openCount})`],
                  ['midia', 'Na mídia'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="client-conversation__filter"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {items.length > 0 && visible.length === 0 && (
            <p className="client-conversation__empty">
              {filter === 'abertas'
                ? 'Nenhum comentário em aberto na mídia.'
                : 'Nenhum comentário na mídia.'}
            </p>
          )}

          {visible.map((item) =>
            item.kind === 'note' ? (
              <MediaNoteCard
                key={item.key}
                note={item.note}
                allNotes={clientNotes}
                media={media}
                clientName={clientName}
                membros={membros}
                workspaceUsers={workspaceUsers}
                onReply={onNoteReply}
                onStatus={onNoteStatus}
                onSelectMedia={onSelectMedia}
              />
            ) : (
              <div key={item.key} className="client-conversation__approval">
                {item.openCommentsLabel && (
                  <span className="client-conversation__flag">{item.openCommentsLabel}</span>
                )}
                {renderApproval ? (
                  renderApproval(item.approval)
                ) : (
                  <DefaultApproval approval={item.approval} />
                )}
                {item.noteSummary && (
                  <span className="client-conversation__summary">{item.noteSummary}</span>
                )}
              </div>
            ),
          )}
        </Thread>
      )}

      {composer === 'inline' && (
        <div className="drawer-reply-row">
          <input
            className="drawer-input"
            placeholder="Responder ao cliente…"
            aria-label="Responder ao cliente"
            value={replyText}
            onChange={(e) => onReplyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onReplySend();
              }
            }}
          />
          <button
            className="drawer-reply-btn"
            aria-label="Enviar resposta"
            disabled={sendingReply || !replyText.trim()}
            onClick={onReplySend}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
