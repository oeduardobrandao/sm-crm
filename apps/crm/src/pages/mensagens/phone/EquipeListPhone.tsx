import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownUp, Check, Plus, Search, X } from 'lucide-react';
import type { EquipeConversa } from '@/store';
import { ListSkeleton } from '@/components/ui/skeletons';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { EquipeConversaAvatar } from '../components/EquipeShared';
import { formatTime } from '../mensagensLogic';
import {
  equipeConversaPreview,
  sortEquipeConversas,
  type EquipeConversasSort,
} from '../equipeChatLogic';
import './mensagensPhone.css';

/** Header subtitle of the Equipe tab (the Clientes tab shows its own). */
export const EQUIPE_INFO = 'Grupos e mensagens diretas com a sua equipe.';

const SORT_LABEL: Record<EquipeConversasSort, string> = {
  recentes: 'Mais recentes',
  antigas: 'Mais antigas',
};

interface Props {
  conversas: EquipeConversa[];
  isLoading: boolean;
  isError: boolean;
  /** Last message by this user shows as "Você: ...". */
  currentUserId: string | null;
  onSelect: (conversaId: number) => void;
  onNovaConversa: () => void;
  /** Rendered first under the large title (the Clientes | Equipe control). */
  headerExtra?: ReactNode;
}

/**
 * Equipe list below 768px: the same page header and grouped list as the Clientes tab
 * (MensagensListPhone), with Nova conversa next to Buscar and Ordenar.
 */
export function EquipeListPhone({
  conversas,
  isLoading,
  isError,
  currentUserId,
  onSelect,
  onNovaConversa,
  headerExtra,
}: Props) {
  const [sort, setSort] = useState<EquipeConversasSort>('recentes');
  const [busca, setBusca] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const visiveis = useMemo(() => {
    const ordenadas = sortEquipeConversas(conversas, sort);
    const q = busca.trim().toLowerCase();
    return q ? ordenadas.filter((c) => c.display_nome.toLowerCase().includes(q)) : ordenadas;
  }, [conversas, sort, busca]);

  return (
    <div className="phone-msg">
      <PhonePageHeader
        title="Mensagens"
        subtitle={EQUIPE_INFO}
        actions={
          <>
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : 'Buscar conversa'}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  setBusca('');
                  setSearchOpen(false);
                } else {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }
              }}
            >
              {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
            </PhoneIconButton>
            <PhoneIconButton
              label={`Ordenar: ${SORT_LABEL[sort]}`}
              aria-haspopup="dialog"
              onClick={() => setSortOpen(true)}
            >
              <ArrowDownUp aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton
              label="Nova conversa"
              aria-haspopup="dialog"
              data-testid="nova-conversa-btn"
              onClick={onNovaConversa}
            >
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      >
        {headerExtra}
        {searchOpen && (
          <div className="phone-msg-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa..."
              aria-label="Buscar conversa"
            />
          </div>
        )}
      </PhonePageHeader>

      {isLoading && (
        <div className="phone-msg-group">
          <ListSkeleton rows={6} avatar className="px-4 py-3" />
        </div>
      )}
      {isError && <p className="phone-msg-note">Não foi possível carregar as conversas.</p>}
      {!isLoading && !isError && visiveis.length === 0 && (
        <p className="phone-msg-note">
          {busca.trim()
            ? 'Nenhuma conversa encontrada.'
            : 'Nenhuma conversa ainda. Crie uma para falar com a equipe.'}
        </p>
      )}
      {visiveis.length > 0 && (
        <ul className="phone-kit phone-msg-group" aria-label="Conversas da equipe">
          {visiveis.map((c) => (
            <li key={c.conversa_id} className="phone-msg-row">
              <button
                type="button"
                className="phone-msg-row__main"
                data-testid={`equipe-conversa-${c.conversa_id}`}
                onClick={() => onSelect(c.conversa_id)}
              >
                <EquipeConversaAvatar conversa={c} size={44} />
                <span className="phone-msg-row__body">
                  <span className="phone-msg-row__line">
                    <span className="phone-msg-row__name">{c.display_nome}</span>
                    {c.last_created_at != null && (
                      <span className="phone-msg-row__time">{formatTime(c.last_created_at)}</span>
                    )}
                  </span>
                  <span className="phone-msg-row__line">
                    <span className="phone-msg-row__preview">
                      {equipeConversaPreview(c, currentUserId)}
                    </span>
                    {c.unread_count > 0 && (
                      <span
                        className="phone-msg-row__badge"
                        aria-label={`${c.unread_count} não lidas`}
                      >
                        {c.unread_count > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title="Ordenar conversas"
        actions={(['recentes', 'antigas'] as const).map((s) => ({
          label: SORT_LABEL[s],
          icon: sort === s ? <Check aria-hidden="true" /> : undefined,
          onSelect: () => setSort(s),
        }))}
      />
    </div>
  );
}
