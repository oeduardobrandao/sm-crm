import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, FilePen, Send, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import { useCornerClearance } from '@/hooks/useCornerClearance';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import type { useMensagensData } from '../hooks/useMensagensData';
import { AutorAvatar, ClienteAvatar } from './Avatars';
import { PostChip } from './PostChip';
import { useConversationThread } from '../hooks/useConversationThread';
import {
  eventLabel,
  feedItemKey,
  formatTime,
  isEventRow,
  mediaNoteLabel,
  TIPO_FILTERS,
} from '../mensagensLogic';

type MensagensData = ReturnType<typeof useMensagensData>;

interface ConversationThreadProps {
  conversa: MensagemConversa;
  feed: MensagensData['feed'];
  sendGeneral: MensagensData['sendGeneral'];
  replyToPost: MensagensData['replyToPost'];
  clientesById: Map<number, Cliente>;
  /** Provided on mobile only — shows the back arrow and returns to /mensagens. */
  onBack?: () => void;
}

export function ConversationThread({
  conversa,
  feed,
  sendGeneral,
  replyToPost,
  clientesById,
  onBack,
}: ConversationThreadProps) {
  const { t } = useTranslation('messages');
  const { tipo, setTipo, draft, setDraft, replyTo, setReplyTo, itens, scrollRef, enviar } =
    useConversationThread({ conversa, feed, sendGeneral, replyToPost });
  const vidroShell = useVidroShell();
  // The composer owns the bottom edge: the floating corner stacks above it.
  const composerRef = useRef<HTMLDivElement>(null);
  useCornerClearance(composerRef);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden mensagens-thread-root">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label={t('shared.backToConversations')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <ClienteAvatar
          nome={conversa.cliente_nome}
          fotoUrl={conversa.cliente_foto_url}
          cliente={clientesById.get(conversa.cliente_id)}
        />
        <span className="flex-1 truncate text-sm font-semibold">{conversa.cliente_nome}</span>
        <span className="flex gap-1">
          {TIPO_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTipo(f.id)}
              className="rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
              style={{
                border: 'none',
                cursor: 'pointer',
                background: tipo === f.id ? 'var(--text-main)' : 'transparent',
                color: tipo === f.id ? 'var(--card-bg)' : 'var(--text-muted)',
                fontWeight: tipo === f.id ? 600 : 400,
              }}
            >
              {f.label}
            </button>
          ))}
        </span>
      </div>

      <div
        ref={scrollRef}
        data-testid="thread-scroll"
        className="mensagens-thread-scroll flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-4"
        style={{ background: 'var(--bg-color)' }}
      >
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="self-center text-xs font-semibold text-[var(--text-muted)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {feed.isFetchingNextPage ? t('loading') : t('shared.loadOlder')}
          </button>
        )}
        {feed.isError && (
          <div className="flex flex-col items-center gap-2 self-center py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">{t('shared.loadMessagesError')}</p>
            <button
              onClick={() => feed.refetch()}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {t('shared.retry')}
            </button>
          </div>
        )}
        {!feed.isError && feed.isLoading && <ThreadSkeleton />}
        {!feed.isError && !feed.isLoading && itens.length === 0 && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">
            {t('conversationThread.empty')}
          </p>
        )}
        {itens.map((m) => {
          const daEquipe = m.is_workspace_user;
          const notaLabel = mediaNoteLabel(m);
          if (isEventRow(m)) {
            return (
              <div
                key={feedItemKey(m)}
                className="mensagens-event-row flex max-w-full items-center gap-2 self-start text-xs text-[var(--text-muted)]"
              >
                {m.source === 'edit_suggestion' ? (
                  <FilePen size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                <span>{eventLabel(m)}</span>
                {m.post_id != null && (
                  <PostChip postId={m.post_id} workflowId={m.workflow_id} titulo={m.post_titulo} />
                )}
                <span className="mensagens-event-row__time whitespace-nowrap">
                  · {formatTime(m.created_at)}
                </span>
              </div>
            );
          }
          return (
            <div
              key={feedItemKey(m)}
              className={`flex max-w-[78%] items-end gap-2 ${daEquipe ? 'flex-row-reverse self-end' : 'self-start'}`}
            >
              <AutorAvatar
                item={m}
                cliente={clientesById.get(m.cliente_id)}
                clienteFotoUrl={conversa.cliente_foto_url}
              />
              <div
                className={`flex min-w-0 flex-col gap-1 ${daEquipe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-full rounded-2xl px-3.5 py-2.5 text-sm vidro-bubble ${daEquipe ? 'vidro-bubble--me' : 'vidro-bubble--them'}`}
                  style={
                    vidroShell
                      ? undefined
                      : {
                          background: daEquipe ? 'var(--surface-hover)' : 'var(--card-bg)',
                          boxShadow: 'inset 0 0 0 1px var(--border-color)',
                        }
                  }
                >
                  {daEquipe && (
                    <div className="vidro-bubble__meta mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {m.author_name ?? t('shared.team')}
                    </div>
                  )}
                  {notaLabel && (
                    <div className="vidro-bubble__meta mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {notaLabel}
                    </div>
                  )}
                  {m.action === 'correcao' && (
                    <div className="vidro-bubble__meta mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {t('events.correction')}
                    </div>
                  )}
                  {m.content && (
                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                  )}
                  {m.post_id != null && (
                    <div className="mt-2 text-xs">
                      <PostChip
                        postId={m.post_id}
                        workflowId={m.workflow_id}
                        titulo={m.post_titulo}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-light)]">
                  <span>{formatTime(m.created_at)}</span>
                  {m.post_id != null && (
                    <button
                      onClick={() =>
                        setReplyTo({
                          postId: m.post_id!,
                          workflowId: m.workflow_id,
                          titulo: m.post_titulo ?? 'Post',
                        })
                      }
                      className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      {t('conversationThread.reply')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        ref={composerRef}
        className="flex flex-col gap-2 border-t border-[var(--border-color)] p-3.5"
      >
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="min-w-0 truncate">
              <Trans
                t={t}
                i18nKey="conversationThread.replyingTo"
                values={{ title: replyTo.titulo }}
                components={{ b: <strong /> }}
              />
            </span>
            <button
              onClick={() => setReplyTo(null)}
              aria-label={t('conversationThread.cancelReply')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            data-variant="bare"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enviar();
            }}
            placeholder={
              replyTo
                ? t('conversationThread.replyPlaceholder')
                : t('conversationThread.messagePlaceholder')
            }
            className="min-w-0 flex-1 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={enviar}
            disabled={sendGeneral.isPending || replyToPost.isPending || !draft.trim()}
            aria-label={t('shared.sendMessage')}
            className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50 bg-[var(--primary-color)]"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Alternating bubbles (client left, team right) while the first page of the thread loads. */
export function ThreadSkeleton() {
  const bubbles: { mine: boolean; w: string; h: string }[] = [
    { mine: false, w: '52%', h: 'h-12' },
    { mine: true, w: '40%', h: 'h-9' },
    { mine: false, w: '64%', h: 'h-16' },
    { mine: true, w: '46%', h: 'h-12' },
  ];
  return (
    <SkeletonStatus>
      <div className="flex flex-col gap-3">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={`flex w-full items-end gap-2 ${b.mine ? 'flex-row-reverse' : ''}`}
          >
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className={`${b.h} rounded-2xl`} style={{ width: b.w }} />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}
