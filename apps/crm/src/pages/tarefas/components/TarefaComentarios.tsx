import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { format, formatDistanceStrict, isSameDay, subDays } from 'date-fns';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MessageCircle, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react';
import { useDateFnsLocale } from '@mesaas/i18n';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { useAuth } from '@/context/AuthContext';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { MentionEditor } from '@/components/mentions/MentionEditor';
import { MentionText } from '@/components/mentions/MentionText';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TAREFA_COMENTARIO_MAX_CHARS, type Membro, type TarefaComentario } from '@/store';
import {
  useDiscussaoComposer,
  useMinuteClock,
} from '@/pages/entregas/discussao/useDiscussaoActions';
import { useTarefaComentarios } from '../hooks/useTarefaComentarios';
import { useWorkspaceUsersWithSelf } from '../hooks/useWorkspaceUsersWithSelf';

/** The counter shows from this many characters on, so the cap is never a surprise. */
const COUNTER_FROM = Math.floor(TAREFA_COMENTARIO_MAX_CHARS * 0.9);

interface WorkspaceUser {
  id: string;
  nome: string;
  avatar_url: string | null;
}

interface Author {
  nome: string;
  avatarUrl: string | null;
}

/** Same order as the post discussion's resolveAuthor (DiscussaoEquipe.tsx): workspace users
 *  first, then membros; a NULL or unknown author is a deleted account. */
function resolveAuthor(
  userId: string | null,
  membros: Membro[],
  workspaceUsers: WorkspaceUser[],
  removedLabel: string,
): Author {
  if (!userId) return { nome: removedLabel, avatarUrl: null };
  const wsUser = workspaceUsers.find((u) => u.id === userId);
  if (wsUser) return { nome: wsUser.nome, avatarUrl: wsUser.avatar_url };
  const membro = membros.find((m) => m.crm_user_id === userId);
  if (membro) return { nome: membro.nome, avatarUrl: membro.avatar_url ?? null };
  return { nome: removedLabel, avatarUrl: null };
}

type Item =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'comment'; key: string; comentario: TarefaComentario };

export interface TarefaComentariosProps {
  tarefaId: number;
  membros: Membro[];
  /** Deep link (`&comentarios=1`): scroll the section into view and focus the composer. */
  autoFocus?: boolean;
}

/** "Comentários (n)" on a task: flat team thread, @mentions, author-only edit/delete. */
export function TarefaComentarios({ tarefaId, membros, autoFocus }: TarefaComentariosProps) {
  const { t } = useTranslation('tasksForm');
  const dateLocale = useDateFnsLocale();
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const now = useMinuteClock();

  const thread = useTarefaComentarios(tarefaId);
  const workspaceUsers: WorkspaceUser[] = useWorkspaceUsersWithSelf();

  const { send: sendComentario, sending } = thread;
  const composerTarget = useMemo(
    () => ({ send: sendComentario, sending }),
    [sendComentario, sending],
  );
  const { draft, setDraft, editorRef, tooLong, canSend, handleSend, handleKeyDown } =
    useDiscussaoComposer(composerTarget, t('comentarios.sendError'));
  const length = draft.trim().length;

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView?.({ block: 'nearest' });
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, editorRef]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let lastDay: Date | null = null;
    for (const c of thread.comentarios) {
      const at = new Date(c.created_at);
      if (!lastDay || !isSameDay(lastDay, at)) {
        let label: string;
        if (isSameDay(at, now)) label = t('comentarios.today');
        else if (isSameDay(at, subDays(now, 1))) label = t('comentarios.yesterday');
        else label = format(at, t('comentarios.dayFormat'), { locale: dateLocale });
        out.push({ kind: 'day', key: `day-${c.id}`, label });
        lastDay = at;
      }
      out.push({ kind: 'comment', key: String(c.id), comentario: c });
    }
    return out;
  }, [thread.comentarios, now, t, dateLocale]);

  return (
    <section
      id="tarefa-comentarios"
      ref={sectionRef}
      className="tarefa-comentarios"
      aria-labelledby={titleId}
    >
      <h3 id={titleId} className="tarefa-comentarios-title">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {t('comentarios.title')}
        <span className="tarefa-comentarios-count">{thread.comentarios.length}</span>
      </h3>

      {!thread.isLoading && items.length === 0 && (
        <p className="tarefa-comentarios-empty">{t('comentarios.empty')}</p>
      )}

      {items.length > 0 && (
        <div className="discussao-timeline">
          {items.map((item) =>
            item.kind === 'day' ? (
              <div
                key={item.key}
                className="discussao-divider"
                role="separator"
                aria-label={item.label}
              >
                <span>{item.label}</span>
              </div>
            ) : (
              <ComentarioRow
                key={item.key}
                comentario={item.comentario}
                author={resolveAuthor(
                  item.comentario.author_id,
                  membros,
                  workspaceUsers,
                  t('comentarios.removedUser'),
                )}
                isOwn={!!currentUserId && item.comentario.author_id === currentUserId}
                now={now}
                onSave={thread.update}
                onDelete={thread.remove}
              />
            ),
          )}
        </div>
      )}

      <div className="discussao-composer-wrap">
        <div className="discussao-composer">
          <MentionEditor
            ref={editorRef}
            className="discussao-input"
            rootClassName="discussao-composer-field"
            placeholder={t('comentarios.placeholder')}
            value={draft}
            onValueChange={setDraft}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="discussao-send"
            aria-label={t('comentarios.send')}
            // Clicking must not pull focus out of the editor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
            disabled={!canSend}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {tooLong && (
          <p className="discussao-limit" role="alert">
            {t('comentarios.tooLong', { max: TAREFA_COMENTARIO_MAX_CHARS })}
          </p>
        )}
        <div className="tarefa-comentarios-footer">
          <p className="discussao-hint">{t('comentarios.hint')}</p>
          {length >= COUNTER_FROM && (
            <span
              className={`tarefa-comentarios-counter${tooLong ? ' tarefa-comentarios-counter--over' : ''}`}
            >
              {length}/{TAREFA_COMENTARIO_MAX_CHARS}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function ComentarioRow({
  comentario,
  author,
  isOwn,
  now,
  onSave,
  onDelete,
}: {
  comentario: TarefaComentario;
  author: Author;
  isOwn: boolean;
  now: Date;
  onSave: (id: number, conteudo: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const { t } = useTranslation('tasksForm');
  const dateLocale = useDateFnsLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comentario.conteudo);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > TAREFA_COMENTARIO_MAX_CHARS;

  useUnsavedWork(busy || (editing && trimmed !== comentario.conteudo));

  const createdAt = new Date(comentario.created_at);
  const relative =
    now.getTime() - createdAt.getTime() < 60_000
      ? t('comentarios.justNow')
      : formatDistanceStrict(createdAt, now, { addSuffix: true, locale: dateLocale });

  const startEdit = () => {
    setDraft(comentario.conteudo);
    setEditing(true);
  };

  const save = async () => {
    if (!trimmed || tooLong) return;
    if (trimmed === comentario.conteudo) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(comentario.id, trimmed);
      setEditing(false);
    } catch {
      toast.error(t('comentarios.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(comentario.id);
    } catch {
      toast.error(t('comentarios.deleteError'));
      setBusy(false);
    }
  };

  return (
    <div className="discussao-message" data-testid={`tarefa-comentario-${comentario.id}`}>
      <PessoaAvatar
        nome={author.nome}
        fotoUrl={author.avatarUrl}
        seed={comentario.author_id ?? `comentario-${comentario.id}`}
        size={28}
        className="discussao-avatar"
      />
      <div className="discussao-message-main">
        <div className="discussao-message-meta">
          <span className="discussao-message-author">{author.nome}</span>
          <time
            className="discussao-message-time"
            dateTime={comentario.created_at}
            title={format(createdAt, t('comentarios.fullDateFormat'), { locale: dateLocale })}
          >
            {relative}
          </time>
          {comentario.edited_at && (
            <span className="discussao-message-edited">{t('comentarios.edited')}</span>
          )}
          {isOwn && !editing && (
            <span className="discussao-message-actions">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="discussao-icon-btn"
                    aria-label={t('comentarios.actions')}
                    disabled={busy}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={startEdit}>
                    <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    {t('comentarios.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    {t('comentarios.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )}
        </div>
        {editing ? (
          <div className="discussao-edit">
            <MentionEditor
              className="discussao-input"
              rootClassName="discussao-edit-field"
              placeholder={t('comentarios.editPlaceholder')}
              value={draft}
              onValueChange={setDraft}
              disabled={busy}
              autoFocus
            />
            {tooLong && (
              <p className="discussao-limit" role="alert">
                {t('comentarios.tooLong', { max: TAREFA_COMENTARIO_MAX_CHARS })}
              </p>
            )}
            <div className="discussao-edit-actions">
              <button
                type="button"
                className="discussao-edit-save"
                onClick={save}
                disabled={busy || !trimmed || tooLong}
              >
                {t('comentarios.save')}
              </button>
              <button
                type="button"
                className="discussao-edit-cancel"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                {t('comentarios.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <p className="discussao-message-text">
            <MentionText text={comentario.conteudo} />
          </p>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('comentarios.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('comentarios.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('comentarios.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              {t('comentarios.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
