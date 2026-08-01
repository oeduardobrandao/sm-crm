import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FilePen, X } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchMensagens, markMensagensSeen, sendHubMensagem, submitApproval } from '../api';
import type { MensagemFeedItem, MensagensCursor } from '../types';

const PAGE_SIZE = 50;

function itemKey(m: MensagemFeedItem) {
  return `${m.source}-${m.item_id}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
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

function eventLabel(m: MensagemFeedItem) {
  if (m.source === 'edit_suggestion') return 'Você sugeriu edições no texto';
  return m.action === 'aprovado' ? 'Você aprovou o post' : 'Você pediu correção';
}

export function MensagensPage() {
  const { bootstrap, token, workspace } = useHub();
  const base = `/${workspace}/hub/${token}`;
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ post_id: number; titulo: string } | null>(null);

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
    markMensagensSeen(token).then(() => {
      qc.invalidateQueries({ queryKey: ['hub-mensagens-count', token] });
    });
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
            Mensagens
          </h1>
        </header>
        <p className="text-sm hub-tx2">
          Este recurso ainda não está disponível no seu plano. Fale com sua agência para saber mais.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 hub-fade-up">
      <header>
        <h1 className="font-display text-[1.7rem] sm:text-[2.4rem] font-medium tracking-tight hub-txt">
          Mensagens
        </h1>
        <p className="text-sm hub-tx2 mt-1">
          Toda a conversa com a equipe em um só lugar: mensagens, aprovações e sugestões.
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
              {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          )}
          {feed.isLoading && <p className="text-sm hub-tx3 self-center py-8">Carregando…</p>}
          {feed.isError && (
            <p className="text-sm hub-tx3 self-center py-8">
              Não foi possível carregar as mensagens.
            </p>
          )}
          {!feed.isLoading && !feed.isError && items.length === 0 && (
            <p className="text-sm hub-tx3 self-center py-8">
              Nenhuma mensagem ainda. Envie a primeira!
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
                  <span>{eventLabel(m)}</span>
                  {m.post_id != null && (
                    <Link to={`${base}/postagens/${m.post_id}`} className="underline hover:hub-txt">
                      {m.post_titulo ?? 'ver post'}
                    </Link>
                  )}
                  <span>· {formatTime(m.created_at)}</span>
                </div>
              );
            }
            return (
              <div key={itemKey(m)} className={`max-w-[78%] ${mine ? 'self-end' : 'self-start'}`}>
                {!mine && (
                  <div className="text-[11px] font-semibold hub-tx3 mb-0.5">
                    {m.author_name ?? 'Equipe'}
                  </div>
                )}
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-sm ${mine ? 'hub-btn-primary' : 'hub-bg-card'}`}
                  style={mine ? undefined : { boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
                >
                  {m.post_id != null && (
                    <Link
                      to={`${base}/postagens/${m.post_id}`}
                      className="block text-[11px] font-semibold underline opacity-80 mb-1"
                    >
                      {m.post_titulo ?? 'Post'}
                      {m.action === 'correcao'
                        ? ' · correção'
                        : m.action === 'aprovado'
                          ? ' · aprovação'
                          : ''}
                    </Link>
                  )}
                  {m.content}
                </div>
                <div
                  className={`mt-1 flex items-center gap-2 text-[11px] hub-tx3 ${mine ? 'justify-end' : ''}`}
                >
                  <span>{formatTime(m.created_at)}</span>
                  {m.post_id != null && (
                    <button
                      onClick={() =>
                        setReplyTo({ post_id: m.post_id!, titulo: m.post_titulo ?? 'Post' })
                      }
                      className="font-semibold hover:hub-txt"
                    >
                      Responder
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
                Respondendo sobre: <strong>{replyTo.titulo}</strong>
              </span>
              <button onClick={() => setReplyTo(null)} aria-label="Cancelar resposta">
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
              placeholder={replyTo ? 'Responder sobre o post…' : 'Enviar mensagem…'}
              className="flex-1 px-[18px] py-3 rounded-full border hub-border-strong text-sm outline-none"
              style={{ background: 'var(--hub-bg)', color: 'var(--hub-txt)' }}
            />
            <button
              onClick={() => draft.trim() && send.mutate(draft.trim())}
              disabled={send.isPending || !draft.trim()}
              className="px-5 py-3 rounded-full text-[13px] font-semibold hub-btn-primary disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
