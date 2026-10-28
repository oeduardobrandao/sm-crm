import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, Plus, Search } from 'lucide-react';
import type { EquipeChatMember, EquipeConversa } from '@/store';
import { EquipeConversaAvatar } from './EquipeShared';
import { formatTime } from '../mensagensLogic';
import {
  equipeConversaPreview,
  equipeSemMensagens,
  equipeListaItemNome,
  sortEquipeLista,
  type EquipeConversasSort,
} from '../equipeChatLogic';

interface EquipeConversationListProps {
  conversas: EquipeConversa[];
  /** Colleagues with no DM yet: listed with the empty conversations. */
  colegas: EquipeChatMember[];
  isLoading: boolean;
  isError: boolean;
  selectedConversaId: number | null;
  /** Last message by this user shows as "Você: ...". */
  currentUserId: string | null;
  onSelect: (conversaId: number) => void;
  /** Opens the DM with a colleague from `colegas`. */
  onSelectColega: (userId: string) => void;
  /** Colleague whose DM is being opened: their rows are disabled meanwhile. */
  abrindoColegaId?: string | null;
  onNovaConversa: () => void;
  className?: string;
}

export function EquipeConversationList({
  conversas,
  colegas,
  isLoading,
  isError,
  selectedConversaId,
  currentUserId,
  onSelect,
  onSelectColega,
  abrindoColegaId = null,
  onNovaConversa,
  className = '',
}: EquipeConversationListProps) {
  const { t } = useTranslation('messages');
  const [sort, setSort] = useState<EquipeConversasSort>('recentes');
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const ordenadas = sortEquipeLista(conversas, colegas, sort);
    const q = busca.trim().toLowerCase();
    if (!q) return ordenadas;
    return ordenadas.filter((item) => equipeListaItemNome(item).toLowerCase().includes(q));
  }, [conversas, colegas, sort, busca]);

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
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
              placeholder={t('equipeConversationList.searchPlaceholder')}
              aria-label={t('equipeConversationList.searchLabel')}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] py-2 pr-3 text-sm outline-none"
              style={{ paddingLeft: '2rem' }}
            />
          </div>
          <button
            onClick={onNovaConversa}
            aria-label={t('shared.newConversation')}
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
          {sort === 'recentes' ? t('shared.sortNewest') : t('shared.sortOldest')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mensagens-list-scroll">
        {isLoading && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">{t('loading')}</p>
        )}
        {isError && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {t('shared.loadConversationsError')}
          </p>
        )}
        {!isLoading && !isError && visiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {busca.trim()
              ? t('equipeConversationList.noConversationFound')
              : t('equipeConversationList.empty')}
          </p>
        )}
        {visiveis.map((item) => {
          if (item.kind === 'colega') {
            const m = item.colega;
            return (
              <EquipeListRow
                key={`colega-${m.user_id}`}
                testId={`equipe-colega-${m.user_id}`}
                avatar={
                  <EquipeConversaAvatar
                    conversa={{ tipo: 'dm', avatar_url: m.avatar_url, display_nome: m.nome }}
                    size={40}
                  />
                }
                nome={m.nome}
                preview={equipeSemMensagens()}
                disabled={abrindoColegaId != null}
                pending={abrindoColegaId === m.user_id}
                onClick={() => onSelectColega(m.user_id)}
              />
            );
          }
          const c = item.conversa;
          return (
            <EquipeListRow
              key={c.conversa_id}
              testId={`equipe-conversa-${c.conversa_id}`}
              active={c.conversa_id === selectedConversaId}
              avatar={<EquipeConversaAvatar conversa={c} size={40} />}
              nome={c.display_nome}
              time={c.last_created_at != null ? formatTime(c.last_created_at) : null}
              preview={equipeConversaPreview(c, currentUserId)}
              unread={c.unread_count}
              onClick={() => onSelect(c.conversa_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function EquipeListRow({
  testId,
  active = false,
  avatar,
  nome,
  time = null,
  preview,
  unread = 0,
  disabled = false,
  pending = false,
  onClick,
}: {
  testId: string;
  active?: boolean;
  avatar: ReactNode;
  nome: string;
  time?: string | null;
  preview: string;
  unread?: number;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending || undefined}
      data-testid={testId}
      className="flex w-full items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
      style={{
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: pending ? 0.6 : undefined,
        ...(active
          ? {
              background: 'rgba(255,191,48,0.12)',
              boxShadow: 'inset 3px 0 0 var(--primary-color)',
            }
          : { background: 'transparent' }),
      }}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{nome}</span>
          {time != null && (
            <span className="shrink-0 text-xs text-[var(--text-light)]">{time}</span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">{preview}</span>
          {unread > 0 && (
            <span className="nav-badge nav-badge--count shrink-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
