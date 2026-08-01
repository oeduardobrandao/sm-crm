import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownUp, ArrowLeft, CheckCircle2, FilePen, Info, Search, Send, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { useMensagensData } from './hooks/useMensagensData';
import { AutorAvatar, ClienteAvatar } from './components/Avatars';
import { PostChip } from './components/PostChip';
import {
  conversaPreview,
  eventLabel,
  feedItemKey,
  isEventRow,
  matchesTipo,
  sortConversas,
  TIPO_FILTERS,
  type ConversasSort,
  type MensagensTipoFilter,
} from './mensagensLogic';

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MensagensPage() {
  const [selecionado, setSelecionado] = useState<MensagemConversa | null>(null);
  const [sort, setSort] = useState<ConversasSort>('recentes');
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Set when a conversation opens or a message is sent: the next settled render
  // snaps the thread to the bottom (never on "carregar anteriores").
  const scrollPending = useRef(false);
  const [replyTo, setReplyTo] = useState<{
    postId: number;
    workflowId: number;
    titulo: string;
  } | null>(null);
  const clienteId = selecionado?.cliente_id ?? null;
  const { feed, conversas, clientes, sendGeneral, replyToPost } = useMensagensData(clienteId);

  const clientesById = useMemo(() => {
    const map = new Map<number, Cliente>();
    for (const c of clientes.data ?? []) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes.data]);

  const conversasOrdenadas = useMemo(
    () => sortConversas(conversas.data ?? [], sort),
    [conversas.data, sort],
  );

  const conversasVisiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversasOrdenadas;
    return conversasOrdenadas.filter((c) => c.cliente_nome.toLowerCase().includes(q));
  }, [conversasOrdenadas, busca]);

  // Thread renders chat-style: ascending, oldest at the top.
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
  }, [feed.isLoading, itens.length, clienteId]);

  async function enviar() {
    const text = draft.trim();
    if (!text || clienteId == null || sendGeneral.isPending || replyToPost.isPending) return;
    try {
      if (replyTo) {
        await replyToPost.mutateAsync({
          postId: replyTo.postId,
          workflowId: replyTo.workflowId,
          content: text,
        });
      } else {
        await sendGeneral.mutateAsync({ cliente: clienteId, content: text });
      }
      setDraft('');
      setReplyTo(null);
      scrollPending.current = true;
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  function abrirConversa(c: MensagemConversa) {
    setSelecionado(c);
    setTipo('todas');
    setReplyTo(null);
    setDraft('');
    scrollPending.current = true;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div
          className="header-title"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <h1>Mensagens</h1>
          <span
            data-tooltip="Toda a comunicação com os clientes, agrupada por conversa. Cada item leva ao post de origem."
            data-tooltip-dir="right"
            style={{ display: 'flex' }}
          >
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
      </header>

      {selecionado == null ? (
        <>
          <div className="flex flex-wrap items-center gap-2 animate-up">
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: '320px' }}>
              <Search
                className="h-4 w-4"
                style={{
                  position: 'absolute',
                  left: '0.625rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente..."
                aria-label="Buscar cliente"
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] py-2 pr-3 text-sm outline-none"
                style={{ paddingLeft: '2rem' }}
              />
            </div>
            <button
              onClick={() => setSort((s) => (s === 'recentes' ? 'antigas' : 'recentes'))}
              className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
              style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
            >
              <ArrowDownUp size={13} />
              {sort === 'recentes' ? 'Mais recentes' : 'Mais antigas'}
            </button>
          </div>

          <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] animate-up">
            {conversas.isLoading && (
              <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
            )}
            {conversas.isError && (
              <p className="py-10 text-center text-sm text-[var(--text-muted)]">
                Não foi possível carregar as conversas.
              </p>
            )}
            {!conversas.isLoading && !conversas.isError && conversasVisiveis.length === 0 && (
              <p className="py-10 text-center text-sm text-[var(--text-muted)]">
                {busca.trim()
                  ? 'Nenhum cliente encontrado.'
                  : 'Nenhuma conversa ainda. As mensagens dos clientes aparecem aqui.'}
              </p>
            )}
            {conversasVisiveis.map((c) => (
              <button
                key={c.cliente_id}
                onClick={() => abrirConversa(c)}
                data-testid={`conversa-${c.cliente_id}`}
                className="flex w-full items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <ClienteAvatar
                  nome={c.cliente_nome}
                  fotoUrl={c.cliente_foto_url}
                  cliente={clientesById.get(c.cliente_id)}
                  size="lg"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.cliente_nome}</span>
                    {c.last_created_at != null && (
                      <span className="shrink-0 text-xs text-[var(--text-light)]">
                        {formatTime(c.last_created_at)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-[var(--text-muted)]">
                      {conversaPreview(c)}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="nav-badge nav-badge--count shrink-0">
                        {c.unread_count > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] animate-up">
          <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
            <button
              onClick={() => setSelecionado(null)}
              aria-label="Voltar para as conversas"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <ArrowLeft size={17} />
            </button>
            <ClienteAvatar
              nome={selecionado.cliente_nome}
              fotoUrl={selecionado.cliente_foto_url}
              cliente={clientesById.get(selecionado.cliente_id)}
            />
            <span className="flex-1 truncate text-sm font-semibold">
              {selecionado.cliente_nome}
            </span>
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
            className="flex min-h-[380px] flex-col gap-3 overflow-y-auto p-4"
            style={{ background: 'var(--bg-color)', maxHeight: '60vh' }}
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
            {feed.isLoading && (
              <p className="self-center py-8 text-sm text-[var(--text-muted)]">Carregando…</p>
            )}
            {!feed.isLoading && itens.length === 0 && (
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
                      <PostChip
                        postId={m.post_id}
                        workflowId={m.workflow_id}
                        titulo={m.post_titulo}
                      />
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
                    clienteFotoUrl={selecionado.cliente_foto_url}
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
      )}
    </div>
  );
}
