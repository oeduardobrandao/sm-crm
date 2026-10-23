import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, BellOff, CheckCircle2, Eye, Lock, RotateCcw, Send } from 'lucide-react';
import { BottomActionBar } from '@/components/mobile';
import { MentionEditor } from '@/components/mentions/MentionEditor';
import type { CommentThreadWithComments, Membro, PostApproval } from '../../../../store';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import type { ReferenceItem } from '@/store/postReferences';
import { DiscussaoTimeline } from '../../discussao/DiscussaoEquipe';
import type { UseDiscussaoResult } from '../../discussao/useDiscussao';
import {
  DISCUSSAO_MAX_CHARS,
  useDiscussaoComposer,
  useDiscussaoMessageActions,
  useMinuteClock,
  useSeguirToggle,
  useShowChatBridge,
} from '../../discussao/useDiscussaoActions';
import { buildTimeline } from '../../discussao/timeline';
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

/**
 * Where the tab opens: Equipe when the team discussion has unread messages, else Cliente
 * when the newest client-side message came from the client (not the team), else Equipe.
 */
function defaultChannel(naoLidasEquipe: number, approvals: PostApproval[]): Channel {
  if (naoLidasEquipe > 0) return 'equipe';
  let newest: PostApproval | null = null;
  for (const a of approvals) {
    if (!newest || new Date(a.created_at).getTime() >= new Date(newest.created_at).getTime()) {
      newest = a;
    }
  }
  return newest && !newest.is_workspace_user ? 'cliente' : 'equipe';
}

interface PhoneCommentsProps {
  postId: number;
  currentUserId: string;
  /** The post's team discussion (the one `useDiscussao` call in PostEditorBody). */
  discussao: UseDiscussaoResult;
  /** "Discutir no chat" control; rendered only on plans with the team chat. */
  chatBridge?: ReactNode;
  approvals: PostApproval[];
  references: ReferenceItem[];
  onOpenReference: (item: ReferenceItem) => void;
  clientName?: string | null;
  replyText: string;
  sendingReply: boolean;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  /** This post's threads (general + passage). */
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string | null }[];
  onThreadClick: (threadId: number) => void;
  /** Pending client edit suggestion: a card that opens the suggestion sheet. */
  suggestion?: { when: string; onOpen: () => void } | null;
  /** Only the visible tab owns the bottom bar slot (the composer). */
  active: boolean;
  /** `&discussao=1` deep link: open on Equipe whatever the unread/participation state says.
   *  Never focuses the composer: the keyboard must not pop. */
  focusEquipe?: boolean;
}

/**
 * Comentários tab. Two audiences behind two pills, never both at once: "Equipe" is the
 * post's internal discussion (the desktop timeline and composer, nothing here reaches the
 * client) and "Cliente" is the approval thread with the "Responder ao cliente…" composer.
 * Both panes stay mounted and only the inactive one is hidden, so a half-typed team
 * message survives a pill switch; each composer lives inside its pane, so exactly one
 * is visible at a time.
 */
export function PhoneComments({
  postId,
  currentUserId,
  discussao,
  chatBridge,
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
  focusEquipe,
}: PhoneCommentsProps) {
  const naoLidasEquipe = discussao.naoLidas;
  const [channel, setChannel] = useState<Channel>(() =>
    focusEquipe ? 'equipe' : defaultChannel(naoLidasEquipe, approvals),
  );
  // The unread count is only meaningful once the participation has loaded, which is after
  // mount on a cold cache: decide again exactly once at that point. After that (or after a
  // tap on a pill) the choice is the user's, so reading the unread messages, which drops
  // the count to 0, never moves them.
  const settledRef = useRef(focusEquipe || discussao.participacao !== undefined);
  useEffect(() => {
    if (settledRef.current || discussao.participacao === undefined) return;
    settledRef.current = true;
    setChannel(defaultChannel(discussao.naoLidas, approvals));
  }, [discussao.participacao, discussao.naoLidas, approvals]);
  const pick = (next: Channel) => {
    settledRef.current = true;
    setChannel(next);
  };
  const client = clientName || 'Cliente';
  const showBridge = useShowChatBridge();

  const now = useMinuteClock();
  const items = useMemo(
    () =>
      buildTimeline({
        threads,
        lastSeenCommentId: discussao.unreadAnchorId,
        currentUserId,
        now,
      }),
    [threads, discussao.unreadAnchorId, currentUserId, now],
  );
  const { handleEditMessage, handleDeleteMessage } = useDiscussaoMessageActions();
  const seguir = useSeguirToggle(discussao);
  const { draft, setDraft, editorRef, tooLong, canSend, handleSend, handleKeyDown } =
    useDiscussaoComposer(discussao);

  const novasLabel =
    naoLidasEquipe > 0 ? ` · ${naoLidasEquipe} ${naoLidasEquipe === 1 ? 'nova' : 'novas'}` : '';

  return (
    <div className="phone-comments" data-post-id={postId}>
      <div className="phone-comments__pills" role="group" aria-label="Conversa">
        <button
          type="button"
          className="phone-comments__pill"
          aria-pressed={channel === 'equipe'}
          onClick={() => pick('equipe')}
        >
          <Lock aria-hidden="true" />
          Equipe{novasLabel}
        </button>
        <button
          type="button"
          className="phone-comments__pill"
          aria-pressed={channel === 'cliente'}
          onClick={() => pick('cliente')}
        >
          <Eye aria-hidden="true" />
          Cliente
        </button>
      </div>

      <div className="phone-comments__pane" data-pane="equipe" hidden={channel !== 'equipe'}>
        <div className="phone-comments__team-note">
          <span>Só a equipe vê esta conversa.</span>
          <span className="phone-comments__team-actions">
            {seguir.ready && (
              <button
                type="button"
                className="phone-comments__icon-btn"
                aria-label={seguir.following ? 'Seguindo' : 'Seguir'}
                onClick={seguir.toggle}
                disabled={seguir.disabled}
              >
                {seguir.following ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
              </button>
            )}
            {showBridge && chatBridge}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="phone-comments__empty">
            Nenhuma mensagem ainda. Escreva para a equipe abaixo.
          </p>
        ) : (
          <DiscussaoTimeline
            items={items}
            membros={membros}
            workspaceUsers={workspaceUsers}
            currentUserId={currentUserId}
            onThreadClick={onThreadClick}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
          />
        )}
        {/* The read marker watches the end of the timeline, not the composer: the composer is
            a fixed bar and always on screen. Seeing the end means the messages were seen. */}
        <div ref={discussao.sectionRef} className="phone-comments__end" aria-hidden="true" />
        {tooLong && (
          <p className="discussao-limit" role="alert">
            Mensagem muito longa. O limite é de {DISCUSSAO_MAX_CHARS} caracteres.
          </p>
        )}
        <BottomActionBar className="phone-comments__composer">
          <MentionEditor
            ref={editorRef}
            className="phone-comments__editor-input"
            rootClassName="phone-comments__editor"
            placeholder="Mensagem para a equipe"
            value={draft}
            onValueChange={setDraft}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="phone-comments__send"
            aria-label="Enviar mensagem para a equipe"
            disabled={!canSend}
            // A tap must not take focus (and the keyboard) away from the editor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
          >
            <Send aria-hidden="true" />
          </button>
        </BottomActionBar>
      </div>

      <div className="phone-comments__pane" data-pane="cliente" hidden={channel !== 'cliente'}>
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
      </div>
    </div>
  );
}
