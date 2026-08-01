import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Info, Send } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMensagensData } from './hooks/useMensagensData';
import { MensagemFeedCard } from './components/MensagemFeedCard';
import { feedItemKey, matchesTipo, TIPO_FILTERS, type MensagensTipoFilter } from './mensagensLogic';

export default function MensagensPage() {
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const { feed, unread, clientes, sendGeneral, replyToPost } = useMensagensData(clienteId);

  const items = useMemo(
    () => (feed.data?.pages ?? []).flat().filter((i) => matchesTipo(i, tipo)),
    [feed.data, tipo],
  );

  // Per-client unread map for the filter labels (spec: filter shows per-client unread).
  const unreadByCliente = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of unread.data ?? []) map.set(r.cliente_id, r.unread_count);
    return map;
  }, [unread.data]);

  async function submitGeneral() {
    if (sendGeneral.isPending || !draft.trim() || clienteId == null) return;
    try {
      await sendGeneral.mutateAsync({ cliente: clienteId, content: draft.trim() });
      setDraft('');
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
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
            data-tooltip="Toda a comunicação com os clientes em um só lugar. Cada item leva ao post de origem."
            data-tooltip-dir="right"
            style={{ display: 'flex' }}
          >
            <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 animate-up">
        <Select
          value={clienteId != null ? String(clienteId) : 'all'}
          onValueChange={(v) => setClienteId(v === 'all' ? null : Number(v))}
        >
          <SelectTrigger
            aria-label="Filtrar por cliente"
            className="!rounded-full !text-xs h-9 px-4 w-auto min-w-[160px] mb-0"
          >
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {(clientes.data ?? []).map((c) => {
              const n = c.id != null ? (unreadByCliente.get(c.id) ?? 0) : 0;
              return (
                <SelectItem key={c.id} value={String(c.id)}>
                  {n > 0 ? `${c.nome} (${n})` : c.nome}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
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
        </div>
      </div>

      {clienteId != null && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitGeneral();
            }}
            placeholder="Enviar mensagem geral para este cliente…"
            className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={submitGeneral}
            disabled={sendGeneral.isPending || !draft.trim()}
            aria-label="Enviar mensagem"
            className="rounded-md px-4 py-2 text-sm font-semibold bg-[var(--primary-color)] disabled:opacity-50"
          >
            <Send size={15} />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {feed.isLoading && (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">Carregando…</p>
        )}
        {feed.isError && (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            Não foi possível carregar as mensagens.
          </p>
        )}
        {!feed.isLoading && !feed.isError && items.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            Nenhuma mensagem por aqui ainda.
          </p>
        )}
        {items.map((item) => (
          <MensagemFeedCard
            key={feedItemKey(item)}
            item={item}
            onReply={(postId, workflowId, content) =>
              replyToPost.mutateAsync({ postId, workflowId, content }).catch((err) => {
                toast.error('Não foi possível enviar a resposta.');
                throw err;
              })
            }
          />
        ))}
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="self-center text-sm font-semibold text-[var(--text-muted)] py-2"
          >
            {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
}
