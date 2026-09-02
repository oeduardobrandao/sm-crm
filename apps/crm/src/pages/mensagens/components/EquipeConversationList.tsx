import { useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Search, Users } from 'lucide-react';
import type { EquipeConversa } from '@/store';
import { initialsOf } from './Avatars';
import { formatTime } from '../mensagensLogic';
import {
  equipeConversaPreview,
  sortEquipeConversas,
  type EquipeConversasSort,
} from '../equipeChatLogic';

interface EquipeConversationListProps {
  conversas: EquipeConversa[];
  isLoading: boolean;
  isError: boolean;
  selectedConversaId: number | null;
  onSelect: (conversaId: number) => void;
  onNovaConversa: () => void;
  className?: string;
}

export function EquipeConversationList({
  conversas,
  isLoading,
  isError,
  selectedConversaId,
  onSelect,
  onNovaConversa,
  className = '',
}: EquipeConversationListProps) {
  const [sort, setSort] = useState<EquipeConversasSort>('recentes');
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const ordenadas = sortEquipeConversas(conversas, sort);
    const q = busca.trim().toLowerCase();
    if (!q) return ordenadas;
    return ordenadas.filter((c) => c.display_nome.toLowerCase().includes(q));
  }, [conversas, sort, busca]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="border-b border-[var(--border-color)] px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="mt-0" style={{ position: 'relative', flex: 1 }}>
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
              placeholder="Buscar conversa..."
              aria-label="Buscar conversa"
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] py-2 pr-3 text-sm outline-none"
              style={{ paddingLeft: '2rem' }}
            />
          </div>
          <button
            onClick={onNovaConversa}
            aria-label="Nova conversa"
            data-testid="nova-conversa-btn"
            className="flex items-center justify-center rounded-md border border-[var(--border-color)] p-2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
            style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
          >
            <Plus size={16} />
          </button>
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

      <div className="flex-1 overflow-y-auto mensagens-list-scroll">
        {isLoading && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {isError && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Não foi possível carregar as conversas.
          </p>
        )}
        {!isLoading && !isError && visiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {busca.trim()
              ? 'Nenhuma conversa encontrada.'
              : 'Nenhuma conversa ainda. Crie uma para falar com a equipe.'}
          </p>
        )}
        {visiveis.map((c) => {
          const isActive = c.conversa_id === selectedConversaId;
          return (
            <button
              key={c.conversa_id}
              onClick={() => onSelect(c.conversa_id)}
              data-testid={`equipe-conversa-${c.conversa_id}`}
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
              {c.tipo === 'dm' && c.avatar_url ? (
                <img
                  src={c.avatar_url}
                  alt=""
                  className="avatar"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  className="avatar"
                  style={{
                    width: 40,
                    height: 40,
                    fontSize: '0.8rem',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {c.tipo === 'grupo' ? <Users size={18} /> : initialsOf(c.display_nome)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.display_nome}</span>
                  {c.last_created_at != null && (
                    <span className="shrink-0 text-xs text-[var(--text-light)]">
                      {formatTime(c.last_created_at)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">
                    {equipeConversaPreview(c)}
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
