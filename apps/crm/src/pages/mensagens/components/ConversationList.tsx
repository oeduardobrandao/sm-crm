import { useMemo, useState } from 'react';
import { ArrowDownUp, Info, Search } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { ClienteAvatar } from './Avatars';
import { conversaPreview, formatTime, sortConversas, type ConversasSort } from '../mensagensLogic';

interface ConversationListProps {
  conversas: MensagemConversa[];
  isLoading: boolean;
  isError: boolean;
  selectedClienteId: number | null;
  clientesById: Map<number, Cliente>;
  onSelect: (clienteId: number) => void;
  className?: string;
}

export function ConversationList({
  conversas,
  isLoading,
  isError,
  selectedClienteId,
  clientesById,
  onSelect,
  className = '',
}: ConversationListProps) {
  const [sort, setSort] = useState<ConversasSort>('recentes');
  const [busca, setBusca] = useState('');

  const conversasOrdenadas = useMemo(() => sortConversas(conversas, sort), [conversas, sort]);

  const conversasVisiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversasOrdenadas;
    return conversasOrdenadas.filter((c) => c.cliente_nome.toLowerCase().includes(q));
  }, [conversasOrdenadas, busca]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="border-b border-[var(--border-color)] px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-[var(--text-main)]">Mensagens</h1>
          <span
            data-tooltip="Toda a comunicação com os clientes, agrupada por conversa. Cada item leva ao post de origem."
            data-tooltip-dir="right"
            style={{ display: 'flex' }}
          >
            <Info className="h-4 w-4 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="mt-3" style={{ position: 'relative' }}>
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
          className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
          style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
        >
          <ArrowDownUp size={13} />
          {sort === 'recentes' ? 'Mais recentes' : 'Mais antigas'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {isError && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Não foi possível carregar as conversas.
          </p>
        )}
        {!isLoading && !isError && conversasVisiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {busca.trim()
              ? 'Nenhum cliente encontrado.'
              : 'Nenhuma conversa ainda. As mensagens dos clientes aparecem aqui.'}
          </p>
        )}
        {conversasVisiveis.map((c) => {
          const isActive = c.cliente_id === selectedClienteId;
          return (
            <button
              key={c.cliente_id}
              onClick={() => onSelect(c.cliente_id)}
              data-testid={`conversa-${c.cliente_id}`}
              className="flex w-full items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
              style={{
                border: 'none',
                cursor: 'pointer',
                ...(isActive
                  ? {
                      background: 'rgba(255,191,48,0.12)',
                      boxShadow: 'inset 3px 0 0 var(--primary-color)',
                    }
                  : { background: 'transparent' }),
              }}
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
                  <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">
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
          );
        })}
      </div>
    </div>
  );
}
