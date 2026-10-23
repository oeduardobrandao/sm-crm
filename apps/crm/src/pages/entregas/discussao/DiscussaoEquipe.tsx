import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  Lock,
  MessagesSquare,
  Pencil,
  Send,
  TextQuote,
  Trash2,
} from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Badge } from '@/components/ui/badge';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { MentionText } from '@/components/mentions/MentionText';
import { MentionEditor, type MentionEditorHandle } from '@/components/mentions/MentionEditor';
import { stripMentionTokens } from '@/components/mentions/mentionTokens';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  deletePostComment,
  updatePostComment,
  type CommentThreadWithComments,
  type PostComment,
} from '@/store/comments';
import type { Membro } from '@/store';
import { buildTimeline, type TimelineItem } from './timeline';
import type { UseDiscussaoResult } from './useDiscussao';

/** Same limit as the team chat and `post_discussao_enviar`. */
export const DISCUSSAO_MAX_CHARS = 4000;
const NOW_REFRESH_MS = 60_000;

const SEND_ERROR = 'Não foi possível enviar. Tente novamente.';

export interface DiscussaoWorkspaceUser {
  id: string;
  nome: string;
  avatar_url: string | null;
}

interface Author {
  nome: string;
  avatarUrl: string | null;
}

function resolveAuthor(
  userId: string,
  membros: Membro[],
  workspaceUsers: DiscussaoWorkspaceUser[],
): Author {
  const wsUser = workspaceUsers.find((u) => u.id === userId);
  if (wsUser) return { nome: wsUser.nome, avatarUrl: wsUser.avatar_url };
  const membro = membros.find((m) => m.crm_user_id === userId);
  return { nome: membro?.nome ?? 'Membro', avatarUrl: membro?.avatar_url ?? null };
}

function timeOf(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

function fullDateOf(iso: string): string {
  return format(new Date(iso), "d 'de' MMMM 'às' HH:mm", { locale: ptBR });
}

function threadCountLabel(replies: number, novas: number): string | null {
  if (novas > 0) return novas === 1 ? '1 nova' : `${novas} novas`;
  if (replies > 0) return replies === 1 ? '1 resposta' : `${replies} respostas`;
  return null;
}

function resolvedLabel(n: number): string {
  return n === 1 ? '1 comentário no texto resolvido' : `${n} comentários no texto resolvidos`;
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export interface DiscussaoTimelineProps {
  items: TimelineItem[];
  membros: Membro[];
  workspaceUsers: DiscussaoWorkspaceUser[];
  currentUserId: string;
  onThreadClick: (threadId: number) => void;
  /** Omit both (read-only views) to hide the edit/delete actions on own messages. */
  onEditMessage?: (comment: PostComment, content: string) => Promise<void>;
  onDeleteMessage?: (comment: PostComment) => Promise<void>;
}

/**
 * The discussion's single timeline: general-thread messages as rows, active passage
 * threads as cards, day dividers, the "Não lidas" marker and the collapsed resolved group.
 * Shared by the desktop section, the phone tab and the read-only history.
 */
export function DiscussaoTimeline({
  items,
  membros,
  workspaceUsers,
  currentUserId,
  onThreadClick,
  onEditMessage,
  onDeleteMessage,
}: DiscussaoTimelineProps) {
  return (
    <div className="discussao-timeline">
      {items.map((item) => {
        switch (item.kind) {
          case 'day':
            return (
              <div key={item.key} className="discussao-divider" role="separator">
                <span>{item.label}</span>
              </div>
            );
          case 'unread':
            return (
              <div
                key={item.key}
                className="discussao-divider discussao-divider--unread"
                role="separator"
              >
                <span>Não lidas</span>
              </div>
            );
          case 'message':
            return (
              <DiscussaoMessage
                key={item.key}
                comment={item.comment}
                author={resolveAuthor(item.comment.author_id, membros, workspaceUsers)}
                isOwn={item.comment.author_id === currentUserId}
                onEdit={onEditMessage}
                onDelete={onDeleteMessage}
              />
            );
          case 'thread':
            return (
              <DiscussaoThreadCard
                key={item.key}
                thread={item.thread}
                replies={item.replies}
                novas={item.novas}
                membros={membros}
                workspaceUsers={workspaceUsers}
                onThreadClick={onThreadClick}
              />
            );
          case 'resolved':
            return (
              <ResolvedGroup
                key={item.key}
                threads={item.threads}
                membros={membros}
                workspaceUsers={workspaceUsers}
                onThreadClick={onThreadClick}
              />
            );
        }
      })}
    </div>
  );
}

function DiscussaoMessage({
  comment,
  author,
  isOwn,
  onEdit,
  onDelete,
}: {
  comment: PostComment;
  author: Author;
  isOwn: boolean;
  onEdit?: (comment: PostComment, content: string) => Promise<void>;
  onDelete?: (comment: PostComment) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [busy, setBusy] = useState(false);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > DISCUSSAO_MAX_CHARS;

  useUnsavedWork(busy || (editing && trimmed !== comment.content));

  const startEdit = () => {
    setDraft(comment.content);
    setEditing(true);
  };

  const save = async () => {
    if (!onEdit || !trimmed || tooLong) return;
    if (trimmed === comment.content) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onEdit(comment, trimmed);
      setEditing(false);
    } catch {
      toast.error('Não foi possível salvar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm('Excluir mensagem?')) return;
    setBusy(true);
    try {
      await onDelete(comment);
    } catch {
      toast.error('Não foi possível excluir. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const canAct = isOwn && !!onEdit && !!onDelete;

  return (
    <div className="discussao-message" data-testid={`discussao-message-${comment.id}`}>
      <PessoaAvatar
        nome={author.nome}
        fotoUrl={author.avatarUrl}
        seed={comment.author_id}
        size={28}
        className="discussao-avatar"
      />
      <div className="discussao-message-main">
        <div className="discussao-message-meta">
          <span className="discussao-message-author">{author.nome}</span>
          <time
            className="discussao-message-time"
            dateTime={comment.created_at}
            title={fullDateOf(comment.created_at)}
          >
            {timeOf(comment.created_at)}
          </time>
          {comment.updated_at && <span className="discussao-message-edited">(editado)</span>}
          {canAct && !editing && (
            <span className="discussao-message-actions">
              <button
                type="button"
                className="discussao-icon-btn"
                aria-label="Editar mensagem"
                title="Editar"
                onClick={startEdit}
                disabled={busy}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="discussao-icon-btn discussao-icon-btn--danger"
                aria-label="Excluir mensagem"
                title="Excluir"
                onClick={remove}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="discussao-edit">
            <MentionEditor
              className="discussao-input"
              rootClassName="discussao-edit-field"
              placeholder="Editar mensagem"
              value={draft}
              onValueChange={setDraft}
              disabled={busy}
              autoFocus
            />
            {tooLong && (
              <p className="discussao-limit" role="alert">
                Mensagem muito longa. O limite é de {DISCUSSAO_MAX_CHARS} caracteres.
              </p>
            )}
            <div className="discussao-edit-actions">
              <button
                type="button"
                className="discussao-edit-save"
                onClick={save}
                disabled={busy || !trimmed || tooLong}
              >
                Salvar
              </button>
              <button
                type="button"
                className="discussao-edit-cancel"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className="discussao-message-text">
            <MentionText text={comment.content} />
          </p>
        )}
      </div>
    </div>
  );
}

function DiscussaoThreadCard({
  thread,
  replies,
  novas,
  membros,
  workspaceUsers,
  onThreadClick,
}: {
  thread: CommentThreadWithComments;
  replies: number;
  novas: number;
  membros: Membro[];
  workspaceUsers: DiscussaoWorkspaceUser[];
  onThreadClick: (threadId: number) => void;
}) {
  const author = resolveAuthor(thread.created_by, membros, workspaceUsers);
  const first = thread.post_comments?.[0];
  const count = threadCountLabel(replies, novas);
  const resolved = thread.status === 'resolved';

  return (
    <button
      type="button"
      className={`discussao-thread${resolved ? ' discussao-thread--resolved' : ''}`}
      onClick={() => onThreadClick(thread.id)}
    >
      <TextQuote className="discussao-thread-icon h-4 w-4" aria-hidden="true" />
      <span className="discussao-thread-body">
        <span className="discussao-thread-meta">
          <span className="discussao-thread-author">{author.nome}</span> comentou no trecho ·{' '}
          {timeOf(thread.created_at)}
          {thread.orphaned && <span className="discussao-thread-chip">texto removido</span>}
        </span>
        <span className="discussao-thread-quote">“{thread.quoted_text}”</span>
        {(first || count) && (
          <span className="discussao-thread-preview">
            {first ? stripMentionTokens(first.content) : null}
            {first && count ? ' · ' : null}
            {count && (
              <span
                className={
                  novas > 0
                    ? 'discussao-thread-count discussao-thread-count--new'
                    : 'discussao-thread-count'
                }
              >
                {count}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="discussao-thread-link">Ver no texto</span>
    </button>
  );
}

function ResolvedGroup({
  threads,
  membros,
  workspaceUsers,
  onThreadClick,
}: {
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers: DiscussaoWorkspaceUser[];
  onThreadClick: (threadId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="discussao-resolved">
      <button
        type="button"
        className="discussao-resolved-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {resolvedLabel(threads.length)}
      </button>
      {open &&
        threads.map((t) => (
          <DiscussaoThreadCard
            key={t.id}
            thread={t}
            replies={Math.max(0, (t.post_comments?.length ?? 0) - 1)}
            novas={0}
            membros={membros}
            workspaceUsers={workspaceUsers}
            onThreadClick={onThreadClick}
          />
        ))}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export interface DiscussaoEquipeProps {
  discussao: UseDiscussaoResult;
  /** This post's threads (general + passage). */
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers: DiscussaoWorkspaceUser[];
  currentUserId: string;
  onThreadClick: (threadId: number) => void;
  /** "Discutir no chat" control; rendered only on plans with the team chat. */
  chatBridge?: ReactNode;
}

/** Keeps "Hoje"/"Ontem" right across midnight without recomputing on every render. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * "Discussão da equipe" in the expanded post (desktop): the post's internal timeline, the
 * follow bell, the chat bridge slot and the composer. Nothing here is visible to the client.
 */
export function DiscussaoEquipe({
  discussao,
  threads,
  membros,
  workspaceUsers,
  currentUserId,
  onThreadClick,
  chatBridge,
}: DiscussaoEquipeProps) {
  const qc = useQueryClient();
  const titleId = useId();
  const { features, isUnlimited } = useWorkspaceLimits();
  // Fail-closed like ProtectedRoute: no features loaded = no bridge.
  const showBridge = isUnlimited || features?.feature_team_chat === true;

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

  const [draft, setDraft] = useState('');
  const editorRef = useRef<MentionEditorHandle>(null);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > DISCUSSAO_MAX_CHARS;
  const canSend = !!trimmed && !tooLong && !discussao.sending;

  useUnsavedWork(trimmed.length > 0 || discussao.sending);

  const handleSend = async () => {
    if (!canSend) return;
    const text = trimmed;
    try {
      await discussao.send(text);
      setDraft('');
    } catch {
      toast.error(SEND_ERROR);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const [togglingSeguir, setTogglingSeguir] = useState(false);
  const following = discussao.isParticipant;
  const handleToggleSeguir = async () => {
    setTogglingSeguir(true);
    try {
      await discussao.toggleSeguir();
    } catch {
      toast.error('Não foi possível atualizar. Tente novamente.');
    } finally {
      setTogglingSeguir(false);
    }
  };

  const refreshThreads = () => {
    void qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
    void qc.invalidateQueries({ queryKey: ['post-discussao-nao-lidas'] });
  };
  // General-thread messages are edited/deleted directly: the thread itself can never be
  // deleted or resolved (the database rejects it), even when its last message goes.
  const handleEditMessage = async (comment: PostComment, content: string) => {
    await updatePostComment(comment.id, content);
    refreshThreads();
  };
  const handleDeleteMessage = async (comment: PostComment) => {
    await deletePostComment(comment.id);
    refreshThreads();
  };

  return (
    <section className="discussao" aria-labelledby={titleId}>
      <div className="discussao-header">
        <MessagesSquare className="discussao-header-icon h-4 w-4" aria-hidden="true" />
        <h3 id={titleId} className="discussao-title">
          Discussão da equipe
        </h3>
        <Badge variant="neutral" size="sm" className="discussao-badge">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Só a equipe vê
        </Badge>
        <span className="discussao-header-spacer" />
        <button
          type="button"
          className="discussao-follow"
          aria-pressed={following}
          onClick={handleToggleSeguir}
          disabled={!discussao.participacao || togglingSeguir}
        >
          {following ? (
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {following ? 'Seguindo' : 'Seguir'}
        </button>
        {showBridge && chatBridge}
      </div>

      {items.length > 0 && (
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

      {/* The read marker watches the composer, not the whole panel: a long discussion is
          taller than twice the viewport and would never reach the 50% visibility threshold.
          The composer sits below the newest message, so seeing it means the end was seen. */}
      <div ref={discussao.sectionRef} className="discussao-composer-wrap">
        <div className="discussao-composer">
          <MentionEditor
            ref={editorRef}
            className="discussao-input"
            rootClassName="discussao-composer-field"
            placeholder="Escreva para a equipe. Use @ para mencionar."
            value={draft}
            onValueChange={setDraft}
            onKeyDown={handleKeyDown}
            disabled={discussao.sending}
          />
          <button
            type="button"
            className="discussao-send"
            aria-label="Enviar"
            onClick={() => void handleSend()}
            disabled={!canSend}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {tooLong && (
          <p className="discussao-limit" role="alert">
            Mensagem muito longa. O limite é de {DISCUSSAO_MAX_CHARS} caracteres.
          </p>
        )}
        <p className="discussao-hint">
          Quem participa da discussão recebe aviso. Enter envia, Shift+Enter quebra a linha.
        </p>
      </div>
    </section>
  );
}
