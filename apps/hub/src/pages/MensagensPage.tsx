import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FilePen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHub } from '../HubContext';
import { fetchMensagens, markMensagensSeen, sendHubMensagem, submitApproval } from '../api';
import { HubPostChip } from '../components/HubPostChip';
import type { MensagemFeedItem, MensagensCursor } from '../types';

const PAGE_SIZE = 50;

function itemKey(m: MensagemFeedItem) {
  return `${m.source}-${m.item_id}`;
}

function formatTime(iso: string, lang: string = 'pt-BR') {
  return new Date(iso).toLocaleString(lang, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Centered event row: commentless approvals/corrections and edit suggestions. */
function isEventRow(m: MensagemFeedItem) {
  if (m.source === 'edit_suggestion') return true;
  return m.source === 'post_feedback' && m.action !== 'mensagem' && !m.content?.trim();
}

function eventLabel(m: MensagemFeedItem, t: (key: string, defaultValue: string) => string) {
  if (m.source === 'edit_suggestion') {
    return t('events.editSuggestion', 'Você sugeriu edições no texto');
  }
  return m.action === 'aprovado'
    ? t('events.approved', 'Você aprovou o post')
    : t('events.correctionRequested', 'Você pediu correção');
}

export function MensagensPage() {
  const { bootstrap, token, workspace } = useHub();
  const { t, i18n } = useTranslation('hubMessages');
  const base = `/${workspace}/hub/${token}`;
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ post_id: number; titulo: string } | null>(null);
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  const enabled = bootstrap.feature_mensagens;

  const feed = useInfiniteQuery({
    queryKey: ['hub-mensagens', token],
    queryFn: ({ pageParam }) => fetchMensagens(token, pageParam),
    initialPageParam: undefined as MensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.items.length !== PAGE_SIZE) return undefined;
      const lastItem = last.items[last.items.length - 1];
      return {
        before: lastItem.created_at,
        beforeSource: lastItem.source,
        beforeItemId: lastItem.item_id,
      };
    },
    enabled,
  });

  useEffect(() => {
    if (!enabled || !token) return;
    markMensagensSeen(token)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['hub-mensagens-count', token] });
      })
      // A failed marker just leaves the badge as-is until the next poll; it
      // must not surface as an unhandled rejection.
      .catch(() => {});
  }, [enabled, token, qc]);

  const items = useMemo(() => {
    const all = (feed.data?.pages ?? []).flatMap((p) => p.items);
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [feed.data]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (replyTo) return submitApproval(token, replyTo.post_id, 'mensagem', text);
      return sendHubMensagem(token, text);
    },
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['hub-mensagens', token] });
    },
  });

  // Guard the route itself, not just the nav link — a workspace without the
  // feature shouldn't be able to reach it by navigating to the URL directly.
  if (!enabled) {
    return (
      <div className="flex flex-col gap-4 hub-fade-up">
        <header>
          <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
            {t('title', 'Mensagens')}
          </h1>
        </header>
        <p className="text-sm hub-tx2">
          {t(
            'disabled.description',
            'Este recurso ainda não está disponível no seu plano. Fale com sua agência para saber mais.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 hub-fade-up">
      <header>
        <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
          {t('title', 'Mensagens')}
        </h1>
        <p className="text-sm hub-tx2 mt-1">
          {t(
            'subtitle',
            'Toda a conversa com a equipe em um só lugar: mensagens, aprovações e sugestões.',
          )}
        </p>
      </header>
      <div className="hub-card flex flex-col min-h-[480px] overflow-hidden">
        <div
          className="flex-1 overflow-y-auto p-5 flex flex-col gap-3"
          style={{ background: 'var(--hub-bg)' }}
        >
          {feed.hasNextPage && (
            <button
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="self-center text-[12px] font-semibold hub-tx3 hover:hub-txt"
            >
              {feed.isFetchingNextPage
                ? t('loading', 'Carregando…')
                : t('loadPrevious', 'Carregar mensagens anteriores')}
            </button>
          )}
          {feed.isLoading && (
            <p className="text-sm hub-tx3 self-center py-8">{t('loading', 'Carregando…')}</p>
          )}
          {feed.isError && (
            <p className="text-sm hub-tx3 self-center py-8">
              {t('loadError', 'Não foi possível carregar as mensagens.')}
            </p>
          )}
          {!feed.isLoading && !feed.isError && items.length === 0 && (
            <p className="text-sm hub-tx3 self-center py-8">
              {t('emptyState', 'Nenhuma mensagem ainda. Envie a primeira!')}
            </p>
          )}
          {items.map((m) => {
            const mine = !m.is_workspace_user;
            if (isEventRow(m)) {
              return (
                <div
                  key={itemKey(m)}
                  className="self-center flex items-center gap-2 text-[12px] hub-tx3"
                >
                  {m.source === 'edit_suggestion' ? (
                    <FilePen size={13} />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}
                  <span>{eventLabel(m, t)}</span>
                  {m.post_id != null && (
                    <HubPostChip
                      postId={m.post_id}
                      titulo={m.post_titulo}
                      base={base}
                      token={token}
                    />
                  )}
                  <span>· {formatTime(m.created_at, dateLocale)}</span>
                </div>
              );
            }
            return (
              <div key={itemKey(m)} className={`max-w-[78%] ${mine ? 'self-end' : 'self-start'}`}>
                {!mine && (
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold hub-tx3">
                    {m.author_avatar_url ? (
                      <img
                        src={m.author_avatar_url}
                        alt=""
                        data-testid="hub-author-avatar"
                        className="h-[18px] w-[18px] rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-bold hub-txt"
                        style={{
                          background: 'var(--hub-soft)',
                          boxShadow: 'inset 0 0 0 1px var(--hub-bd)',
                        }}
                      >
                        {(m.author_name ?? t('defaultAuthorName', 'Equipe'))
                          .split(' ')
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join('')
                          .toUpperCase()}
                      </span>
                    )}
                    {m.author_name ?? t('defaultAuthorName', 'Equipe')}
                  </div>
                )}
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-sm hub-txt ${mine ? '' : 'hub-bg-card'}`}
                  style={
                    mine
                      ? {
                          background: 'var(--hub-soft)',
                          boxShadow: 'inset 0 0 0 1px var(--hub-bd2)',
                        }
                      : { boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }
                  }
                >
                  {m.post_id != null && (
                    <div className="mb-1.5">
                      <HubPostChip
                        postId={m.post_id}
                        titulo={m.post_titulo}
                        suffix={
                          m.action === 'correcao'
                            ? t('postSuffix.correction', ' · correção')
                            : m.action === 'aprovado'
                              ? t('postSuffix.approved', ' · aprovação')
                              : ''
                        }
                        base={base}
                        token={token}
                      />
                    </div>
                  )}
                  {m.content}
                </div>
                <div
                  className={`mt-1 flex items-center gap-2 text-[11px] hub-tx3 ${mine ? 'justify-end' : ''}`}
                >
                  <span>{formatTime(m.created_at, dateLocale)}</span>
                  {m.post_id != null && (
                    <button
                      onClick={() =>
                        setReplyTo({
                          post_id: m.post_id!,
                          titulo: m.post_titulo ?? t('defaultPostTitle', 'Post'),
                        })
                      }
                      className="font-semibold hover:hub-txt"
                    >
                      {t('reply', 'Responder')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-3.5 border-t hub-border flex flex-col gap-2">
          {replyTo && (
            <div className="flex items-center gap-2 text-[12px] hub-tx2">
              <span>
                {t('replyingTo', 'Respondendo sobre:')} <strong>{replyTo.titulo}</strong>
              </span>
              <button
                onClick={() => setReplyTo(null)}
                aria-label={t('cancelReply', 'Cancelar resposta')}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !send.isPending) send.mutate(draft.trim());
              }}
              placeholder={
                replyTo
                  ? t('composer.placeholderReply', 'Responder sobre o post…')
                  : t('composer.placeholderDefault', 'Enviar mensagem…')
              }
              className="flex-1 px-[18px] py-3 rounded-full border hub-border-strong text-sm outline-none"
              style={{ background: 'var(--hub-bg)', color: 'var(--hub-txt)' }}
            />
            <button
              onClick={() => draft.trim() && send.mutate(draft.trim())}
              disabled={send.isPending || !draft.trim()}
              className="px-5 py-3 rounded-full text-[13px] font-semibold hub-btn-primary disabled:opacity-50"
            >
              {t('send', 'Enviar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
