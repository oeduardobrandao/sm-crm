import { useState } from 'react';
import { CheckCircle2, RotateCcw, Send } from 'lucide-react';
import { SegmentedControl, BottomActionBar } from '@/components/mobile';
import type { CommentThreadWithComments, Membro, PostApproval } from '../../../../store';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import type { ReferenceItem } from '@/store/postReferences';
import PostCommentSummary from '../PostCommentSummary';
import { ReferenceChips } from '../references/ReferenceChips';

type Channel = 'cliente' | 'equipe';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PhoneCommentsProps {
  approvals: PostApproval[];
  references: ReferenceItem[];
  onOpenReference: (item: ReferenceItem) => void;
  clientName?: string | null;
  replyText: string;
  sendingReply: boolean;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string | null }[];
  onThreadClick: (threadId: number) => void;
  /** Pending client edit suggestion: a card that opens the suggestion sheet. */
  suggestion?: { when: string; onOpen: () => void } | null;
  /** Only the visible tab owns the bottom bar slot (the composer). */
  active: boolean;
}

/**
 * Comentários tab (EditorComentarios mockup). "Com o cliente" is the post's approval
 * thread (client messages, team replies, approvals and correction requests) with the
 * same reply command as desktop; "Equipe" is the internal comment threads on the text
 * (the desktop PostCommentSummary, same click behaviour).
 */
export function PhoneComments({
  approvals,
  references,
  onOpenReference,
  clientName,
  replyText,
  sendingReply,
  onReplyChange,
  onReplySend,
  threads,
  membros,
  workspaceUsers,
  onThreadClick,
  suggestion,
  active,
}: PhoneCommentsProps) {
  const [channel, setChannel] = useState<Channel>('cliente');
  const client = clientName || 'Cliente';
  const openThreads = threads.filter((t) => t.status === 'active').length;

  return (
    <div className="phone-comments">
      <SegmentedControl
        aria-label="Conversa"
        value={channel}
        onChange={setChannel}
        options={[
          {
            value: 'cliente',
            label: approvals.length > 0 ? `Com o cliente ${approvals.length}` : 'Com o cliente',
          },
          { value: 'equipe', label: openThreads > 0 ? `Equipe ${openThreads}` : 'Equipe' },
        ]}
      />

      {channel === 'cliente' ? (
        <div className="phone-comments__thread" aria-label="Conversa com o cliente" role="log">
          {suggestion && (
            <button
              type="button"
              className="phone-comments__suggestion"
              onClick={suggestion.onOpen}
            >
              <span className="phone-comments__suggestion-dot" aria-hidden="true" />
              <span>
                <strong>Sugestão do cliente</strong>
                <span className="phone-comments__meta">{formatWhen(suggestion.when)}</span>
              </span>
              <span className="phone-comments__suggestion-cta">Revisar</span>
            </button>
          )}
          {approvals.length === 0 && !suggestion && (
            <p className="phone-comments__empty">Nenhuma mensagem com o cliente ainda.</p>
          )}
          {approvals.map((a) => {
            const refs = references.filter((r) => r.post_approval_id === a.id);
            if (a.action === 'aprovado' && !a.is_workspace_user) {
              return (
                <div key={a.id} className="phone-comments__event">
                  <span className="phone-comments__meta">{formatWhen(a.created_at)}</span>
                  <span className="phone-comments__event-label">
                    <CheckCircle2 aria-hidden="true" /> {client} aprovou o post
                  </span>
                  {a.comentario && (
                    <p className="phone-bubble phone-bubble--client">{a.comentario}</p>
                  )}
                </div>
              );
            }
            const team = a.is_workspace_user;
            return (
              <div
                key={a.id}
                className={`phone-comments__row${team ? ' phone-comments__row--team' : ''}`}
              >
                <span className="phone-comments__meta">
                  {team ? 'Equipe' : client}
                  {a.action === 'correcao' && !team && (
                    <span className="phone-comments__tag">
                      <RotateCcw aria-hidden="true" /> Correção solicitada
                    </span>
                  )}
                  {' · '}
                  {formatWhen(a.created_at)}
                </span>
                {a.comentario && (
                  <p
                    className={`phone-bubble${team ? ' phone-bubble--team' : ' phone-bubble--client'}`}
                  >
                    {a.comentario}
                  </p>
                )}
                <ReferenceChips references={refs} onOpen={onOpenReference} />
              </div>
            );
          })}
          {active && (
            <BottomActionBar className="phone-comments__composer">
              <input
                className="phone-comments__input"
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
                type="button"
                className="phone-comments__send"
                aria-label="Enviar resposta"
                disabled={sendingReply || !replyText.trim()}
                onClick={onReplySend}
              >
                <Send aria-hidden="true" />
              </button>
            </BottomActionBar>
          )}
        </div>
      ) : threads.length === 0 ? (
        <p className="phone-comments__empty">
          Nenhum comentário interno. Selecione um trecho do roteiro ou da legenda e toque em
          Comentar.
        </p>
      ) : (
        <PostCommentSummary
          threads={threads}
          membros={membros}
          workspaceUsers={workspaceUsers}
          onThreadClick={onThreadClick}
        />
      )}
    </div>
  );
}
