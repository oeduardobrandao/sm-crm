import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, BellOff, CheckCircle2, Eye, Lock, RotateCcw, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { BottomActionBar } from '@/components/mobile';
import { MentionEditor } from '@/components/mentions/MentionEditor';
import type { CommentThreadWithComments, Membro, PostApproval, PostMedia } from '../../../../store';
import type { MediaNote } from '@/store/mediaNotes';
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
import { ClientConversation } from '../mediaNotes/ClientConversation';

type Channel = 'cliente' | 'equipe';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(getIntlLocale(), {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Where the tab opens: Equipe when the team discussion has unread messages, else Cliente
 * when the newest client-side entry (an approval or a note pinned to the media) came from
 * the client (not the team), else Equipe.
 */
function defaultChannel(
  naoLidasEquipe: number,
  approvals: PostApproval[],
  clientNotes: MediaNote[],
): Channel {
  if (naoLidasEquipe > 0) return 'equipe';
  let newestAt = -Infinity;
  let newestFromClient = false;
  const consider = (iso: string, fromClient: boolean) => {
    const at = new Date(iso).getTime();
    if (at >= newestAt) {
      newestAt = at;
      newestFromClient = fromClient;
    }
  };
  for (const a of approvals) consider(a.created_at, !a.is_workspace_user);
  for (const n of clientNotes) consider(n.created_at, n.author_kind === 'client');
  return newestFromClient ? 'cliente' : 'equipe';
}

interface PhoneCommentsProps {
  postId: number;
  currentUserId: string;
  /** The post's team discussion (the one `useDiscussao` call in PostEditorBody). */
  discussao: UseDiscussaoResult;
  /** "Discutir no chat" control; rendered only on plans with the team chat. */
  chatBridge?: ReactNode;
  approvals: PostApproval[];
  /** Notes pinned to the media, and the media they point at. Only client notes show here. */
  notes: MediaNote[];
  media: PostMedia[];
  onNoteReply: (noteId: number, body: string) => Promise<void>;
  onNoteStatus: (noteIds: number[], status: 'open' | 'resolved') => Promise<void>;
  onSelectMedia?: (linkId: number) => void;
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
   *  Never focuses the composer: the keyboard must not pop. A counter: acts at mount and
   *  whenever it changes to a new non-zero value (a link while the editor is open). */
  focusRequest?: number;
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
  notes,
  media,
  onNoteReply,
  onNoteStatus,
  onSelectMedia,
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
  focusRequest,
}: PhoneCommentsProps) {
  const { t } = useTranslation('postEditor');
  const naoLidasEquipe = discussao.naoLidas;
  const clientNotes = useMemo(() => notes.filter((n) => n.visibility === 'client'), [notes]);
  const openClientNotes = clientNotes.filter((n) => n.status === 'open').length;
  const [channel, setChannel] = useState<Channel>(() =>
    focusRequest ? 'equipe' : defaultChannel(naoLidasEquipe, approvals, clientNotes),
  );
  // The unread count is only meaningful once the participation has loaded, which is after
  // mount on a cold cache: decide again exactly once at that point. After that (or after a
  // tap on a pill) the choice is the user's, so reading the unread messages, which drops
  // the count to 0, never moves them.
  const settledRef = useRef(!!focusRequest || discussao.participacao !== undefined);
  useEffect(() => {
    if (settledRef.current || discussao.participacao === undefined) return;
    settledRef.current = true;
    setChannel(defaultChannel(discussao.naoLidas, approvals, clientNotes));
  }, [discussao.participacao, discussao.naoLidas, approvals, clientNotes]);
  useEffect(() => {
    if (!focusRequest) return;
    settledRef.current = true;
    setChannel('equipe');
  }, [focusRequest]);
  const pick = (next: Channel) => {
    settledRef.current = true;
    setChannel(next);
  };
  const client = clientName || t('postApprovalBubble.client');
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
    naoLidasEquipe > 0 ? ` · ${t('phoneComments.newCount', { count: naoLidasEquipe })}` : '';

  return (
    <div className="phone-comments" data-post-id={postId}>
      <div
        className="phone-comments__pills"
        role="group"
        aria-label={t('phoneComments.conversation')}
      >
        <button
          type="button"
          className="phone-comments__pill"
          aria-pressed={channel === 'equipe'}
          onClick={() => pick('equipe')}
        >
          <Lock aria-hidden="true" />
          {t('phoneComments.team')}
          {novasLabel}
        </button>
        <button
          type="button"
          className="phone-comments__pill"
          aria-pressed={channel === 'cliente'}
          onClick={() => pick('cliente')}
        >
          <Eye aria-hidden="true" />
          {t('phoneComments.client')}
          {openClientNotes > 0
            ? ` · ${t('phoneComments.openCount', { count: openClientNotes })}`
            : ''}
        </button>
      </div>

      <div className="phone-comments__pane" data-pane="equipe" hidden={channel !== 'equipe'}>
        <div className="phone-comments__team-note">
          <span>{t('phoneComments.teamOnly')}</span>
          <span className="phone-comments__team-actions">
            {seguir.ready && (
              <button
                type="button"
                className="phone-comments__icon-btn"
                aria-label={
                  seguir.following ? t('phoneComments.following') : t('phoneComments.follow')
                }
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
          <p className="phone-comments__empty">{t('phoneComments.teamEmpty')}</p>
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
            {t('phoneComments.tooLong', { max: DISCUSSAO_MAX_CHARS })}
          </p>
        )}
        {/* Fixed like the client bar: only the visible tab may own the slot, so neither
            relies on the hidden ancestor staying display: none. */}
        {active && (
          <BottomActionBar className="phone-comments__composer">
            <MentionEditor
              ref={editorRef}
              className="phone-comments__editor-input"
              rootClassName="phone-comments__editor"
              placeholder={t('phoneComments.teamPlaceholder')}
              value={draft}
              onValueChange={setDraft}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="phone-comments__send"
              aria-label={t('phoneComments.sendTeamMessage')}
              disabled={!canSend}
              // A tap must not take focus (and the keyboard) away from the editor.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleSend()}
            >
              <Send aria-hidden="true" />
            </button>
          </BottomActionBar>
        )}
      </div>

      <div className="phone-comments__pane" data-pane="cliente" hidden={channel !== 'cliente'}>
        <div
          className="phone-comments__thread"
          aria-label={t('postEditorBody.clientConversation')}
          role="log"
        >
          {suggestion && (
            <button
              type="button"
              className="phone-comments__suggestion"
              onClick={suggestion.onOpen}
            >
              <span className="phone-comments__suggestion-dot" aria-hidden="true" />
              <span>
                <strong>{t('shared.clientSuggestion')}</strong>
                <span className="phone-comments__meta">{formatWhen(suggestion.when)}</span>
              </span>
              <span className="phone-comments__suggestion-cta">{t('phoneComments.review')}</span>
            </button>
          )}
          {approvals.length === 0 && clientNotes.length === 0 && !suggestion && (
            <p className="phone-comments__empty">{t('phoneComments.clientEmpty')}</p>
          )}
          <ClientConversation
            approvals={approvals}
            notes={notes}
            media={media}
            workspaceUsers={workspaceUsers}
            membros={membros}
            clientName={client}
            replyText={replyText}
            sendingReply={sendingReply}
            onReplyChange={onReplyChange}
            onReplySend={onReplySend}
            onNoteReply={onNoteReply}
            onNoteStatus={onNoteStatus}
            onSelectMedia={onSelectMedia}
            composer="none"
            className="client-conversation--phone"
            renderApproval={(a) => {
              const refs = references.filter((r) => r.post_approval_id === a.id);
              if (a.action === 'aprovado' && !a.is_workspace_user) {
                return (
                  <div className="phone-comments__event">
                    <span className="phone-comments__meta">{formatWhen(a.created_at)}</span>
                    <span className="phone-comments__event-label">
                      <CheckCircle2 aria-hidden="true" />{' '}
                      {t('phoneComments.clientApproved', { client })}
                    </span>
                    {a.comentario && (
                      <p className="phone-bubble phone-bubble--client">{a.comentario}</p>
                    )}
                  </div>
                );
              }
              const team = a.is_workspace_user;
              return (
                <div className={`phone-comments__row${team ? ' phone-comments__row--team' : ''}`}>
                  <span className="phone-comments__meta">
                    {team ? t('phoneComments.team') : client}
                    {a.action === 'correcao' && !team && (
                      <span className="phone-comments__tag">
                        <RotateCcw aria-hidden="true" />{' '}
                        {t('postApprovalBubble.correctionRequested')}
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
            }}
          />
          {active && (
            <BottomActionBar className="phone-comments__composer">
              <input
                className="phone-comments__input"
                placeholder={t('phoneComments.replyPlaceholder')}
                aria-label={t('phoneComments.replyToClient')}
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
                aria-label={t('phoneComments.sendReply')}
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
