import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, FilePen, Send, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import type { useMensagensData } from '../hooks/useMensagensData';
import { AutorAvatar, ClienteAvatar } from './Avatars';
import { PostChip } from './PostChip';
import {
  eventLabel,
  feedItemKey,
  formatTime,
  isEventRow,
  matchesTipo,
  TIPO_FILTERS,
  type MensagensTipoFilter,
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
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{
    postId: number;
    workflowId: number;
    titulo: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Starts true so the very first settled render (including a cold deep
  // link) snaps to the newest message; sending sets it again. "Carregar
  // mensagens anteriores" never sets it, so that fetch doesn't force a
  // snap-to-bottom — it does NOT compensate scrollTop for the newly
  // prepended content's height either, so on a large older batch the
  // previously-topmost message can still end up below the fold. Same gap
  // as the pre-refactor code; real compensation is a follow-up, not part
  // of this task.
  const scrollPending = useRef(true);

  const itens = useMemo(() => {
    const all = (feed.data?.pages ?? []).flat().filter((i) => matchesTipo(i, tipo));
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [feed.data, tipo]);

  useEffect(() => {
    if (!scrollPending.current || feed.isLoading) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPending.current = false;
    }
  }, [feed.isLoading, itens.length]);

  async function enviar() {
    const text = draft.trim();
    if (!text || sendGeneral.isPending || replyToPost.isPending) return;
    try {
      if (replyTo) {
        await replyToPost.mutateAsync({
          postId: replyTo.postId,
          workflowId: replyTo.workflowId,
          content: text,
        });
      } else {
        await sendGeneral.mutateAsync({ cliente: conversa.cliente_id, content: text });
      }
      setDraft('');
      setReplyTo(null);
      scrollPending.current = true;
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden mensagens-thread-root">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar para as conversas"
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
        className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-4"
        style={{ background: 'var(--bg-color)' }}
      >
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="self-center text-xs font-semibold text-[var(--text-muted)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {feed.isError && (
          <div className="flex flex-col items-center gap-2 self-center py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Não foi possível carregar as mensagens.
            </p>
            <button
              onClick={() => feed.refetch()}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!feed.isError && feed.isLoading && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {!feed.isError && !feed.isLoading && itens.length === 0 && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        )}
        {itens.map((m) => {
          const daEquipe = m.is_workspace_user;
          if (isEventRow(m)) {
            return (
              <div
                key={feedItemKey(m)}
                className="flex items-center gap-2 self-center text-xs text-[var(--text-muted)]"
              >
                {m.source === 'edit_suggestion' ? (
                  <FilePen size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                <span>{eventLabel(m)}</span>
                {m.post_id != null && m.workflow_id != null && (
                  <PostChip postId={m.post_id} workflowId={m.workflow_id} titulo={m.post_titulo} />
                )}
                <span>· {formatTime(m.created_at)}</span>
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
              <div className={`flex flex-col gap-1 ${daEquipe ? 'items-end' : 'items-start'}`}>
                <div
                  className="rounded-2xl px-3.5 py-2.5 text-sm"
                  style={{
                    background: daEquipe ? 'var(--surface-hover)' : 'var(--card-bg)',
                    boxShadow: 'inset 0 0 0 1px var(--border-color)',
                  }}
                >
                  {daEquipe && (
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {m.author_name ?? 'Equipe'}
                    </div>
                  )}
                  {m.action === 'correcao' && (
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      Pediu correção
                    </div>
                  )}
                  {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.post_id != null && m.workflow_id != null && (
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
                  {m.post_id != null && m.workflow_id != null && (
                    <button
                      onClick={() =>
                        setReplyTo({
                          postId: m.post_id!,
                          workflowId: m.workflow_id!,
                          titulo: m.post_titulo ?? 'Post',
                        })
                      }
                      className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      Responder
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--border-color)] p-3.5">
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>
              Respondendo sobre: <strong>{replyTo.titulo}</strong>
            </span>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Cancelar resposta"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
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
              if (e.key === 'Enter') enviar();
            }}
            placeholder={replyTo ? 'Responder sobre o post…' : 'Enviar mensagem…'}
            className="flex-1 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={enviar}
            disabled={sendGeneral.isPending || replyToPost.isPending || !draft.trim()}
            aria-label="Enviar mensagem"
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
