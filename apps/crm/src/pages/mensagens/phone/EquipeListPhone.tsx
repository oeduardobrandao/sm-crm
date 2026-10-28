import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownUp, Check, Plus, Search, X } from 'lucide-react';
import type { EquipeChatMember, EquipeConversa } from '@/store';
import { ListSkeleton } from '@/components/ui/skeletons';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { EquipeConversaAvatar } from '../components/EquipeShared';
import { formatTime } from '../mensagensLogic';
import {
  equipeSemMensagens,
  equipeConversaPreview,
  equipeListaItemNome,
  sortEquipeLista,
  type EquipeConversasSort,
} from '../equipeChatLogic';
import './mensagensPhone.css';

const SORT_LABEL_KEY: Record<EquipeConversasSort, 'shared.sortRecentes' | 'shared.sortAntigas'> = {
  recentes: 'shared.sortRecentes',
  antigas: 'shared.sortAntigas',
};

interface Props {
  conversas: EquipeConversa[];
  /** Colleagues with no DM yet: listed with the empty conversations. */
  colegas: EquipeChatMember[];
  isLoading: boolean;
  isError: boolean;
  /** Last message by this user shows as "Você: ...". */
  currentUserId: string | null;
  onSelect: (conversaId: number) => void;
  /** Opens the DM with a colleague from `colegas`. */
  onSelectColega: (userId: string) => void;
  /** Colleague whose DM is being opened: their rows are disabled meanwhile. */
  abrindoColegaId?: string | null;
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
  colegas,
  isLoading,
  isError,
  currentUserId,
  onSelect,
  onSelectColega,
  abrindoColegaId = null,
  onNovaConversa,
  headerExtra,
}: Props) {
  const { t } = useTranslation('messagesPhone');
  const [sort, setSort] = useState<EquipeConversasSort>('recentes');
  const [busca, setBusca] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const visiveis = useMemo(() => {
    const ordenadas = sortEquipeLista(conversas, colegas, sort);
    const q = busca.trim().toLowerCase();
    return q
      ? ordenadas.filter((item) => equipeListaItemNome(item).toLowerCase().includes(q))
      : ordenadas;
  }, [conversas, colegas, sort, busca]);

  return (
    <div className="phone-msg">
      <PhonePageHeader
        title={t('shared.title')}
        // Header subtitle of the Equipe tab (the Clientes tab shows its own).
        subtitle={t('equipeList.info')}
        actions={
          <>
            <PhoneIconButton
              label={searchOpen ? t('shared.closeSearch') : t('equipeList.searchConversation')}
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
              label={t('shared.sortBy', { label: t(SORT_LABEL_KEY[sort]) })}
              aria-haspopup="dialog"
              onClick={() => setSortOpen(true)}
            >
              <ArrowDownUp aria-hidden="true" />
            </PhoneIconButton>
            <PhoneIconButton
              label={t('equipeList.newConversation')}
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
              placeholder={t('equipeList.searchPlaceholder')}
              aria-label={t('equipeList.searchConversation')}
            />
          </div>
        )}
      </PhonePageHeader>

      {isLoading && (
        <div className="phone-msg-group">
          <ListSkeleton rows={6} avatar className="px-4 py-3" />
        </div>
      )}
      {isError && <p className="phone-msg-note">{t('shared.loadError')}</p>}
      {!isLoading && !isError && visiveis.length === 0 && (
        <p className="phone-msg-note">
          {busca.trim() ? t('equipeList.noResults') : t('equipeList.empty')}
        </p>
      )}
      {visiveis.length > 0 && (
        <ul className="phone-kit phone-msg-group" aria-label={t('equipeList.listLabel')}>
          {visiveis.map((item) => {
            if (item.kind === 'colega') {
              const m = item.colega;
              return (
                <li key={`colega-${m.user_id}`} className="phone-msg-row">
                  <button
                    type="button"
                    className="phone-msg-row__main"
                    data-testid={`equipe-colega-${m.user_id}`}
                    disabled={abrindoColegaId != null}
                    aria-busy={abrindoColegaId === m.user_id || undefined}
                    style={abrindoColegaId === m.user_id ? { opacity: 0.6 } : undefined}
                    onClick={() => onSelectColega(m.user_id)}
                  >
                    <EquipeConversaAvatar
                      conversa={{ tipo: 'dm', avatar_url: m.avatar_url, display_nome: m.nome }}
                      size={44}
                    />
                    <span className="phone-msg-row__body">
                      <span className="phone-msg-row__line">
                        <span className="phone-msg-row__name">{m.nome}</span>
                      </span>
                      <span className="phone-msg-row__line">
                        <span className="phone-msg-row__preview">{equipeSemMensagens()}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            }
            const c = item.conversa;
            return (
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
                          aria-label={t('shared.unreadBadge', { n: c.unread_count })}
                        >
                          {c.unread_count > 99 ? '99+' : c.unread_count}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('shared.sortTitle')}
        actions={(['recentes', 'antigas'] as const).map((s) => ({
          label: t(SORT_LABEL_KEY[s]),
          icon: sort === s ? <Check aria-hidden="true" /> : undefined,
          onSelect: () => setSort(s),
        }))}
      />
    </div>
  );
}
