import { useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Check, Search, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { ListSkeleton } from '@/components/ui/skeletons';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { ClienteAvatar } from '../components/Avatars';
import { conversaPreview, formatTime, sortConversas, type ConversasSort } from '../mensagensLogic';
import './mensagensPhone.css';

/** The desktop list's Info tooltip text, visible here as the header subtitle. */
export const MENSAGENS_INFO =
  'Toda a comunicação com os clientes, agrupada por conversa. Cada item leva ao post de origem.';

const SORT_LABEL: Record<ConversasSort, string> = {
  recentes: 'Mais recentes',
  antigas: 'Mais antigas',
};

interface Props {
  conversas: MensagemConversa[];
  isLoading: boolean;
  isError: boolean;
  clientesById: Map<number, Cliente>;
  onSelect: (clienteId: number) => void;
}

/**
 * Mensagens list below 768px (FMensagens): page header with the info text as subtitle,
 * Buscar (collapsible field) and Ordenar (action sheet) in the toolbar, conversations as
 * one grouped list with the unread count.
 */
export function MensagensListPhone({
  conversas,
  isLoading,
  isError,
  clientesById,
  onSelect,
}: Props) {
  const [sort, setSort] = useState<ConversasSort>('recentes');
  const [busca, setBusca] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const visiveis = useMemo(() => {
    const ordenadas = sortConversas(conversas, sort);
    const q = busca.trim().toLowerCase();
    return q ? ordenadas.filter((c) => c.cliente_nome.toLowerCase().includes(q)) : ordenadas;
  }, [conversas, sort, busca]);

  return (
    <div className="phone-msg">
      <PhonePageHeader
        title="Mensagens"
        subtitle={MENSAGENS_INFO}
        actions={
          <>
            <PhoneIconButton
              label={searchOpen ? 'Fechar busca' : 'Buscar cliente'}
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
          </>
        }
      >
        {searchOpen && (
          <div className="phone-msg-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente..."
              aria-label="Buscar cliente"
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
            ? 'Nenhum cliente encontrado.'
            : 'Nenhuma conversa ainda. As mensagens dos clientes aparecem aqui.'}
        </p>
      )}
      {visiveis.length > 0 && (
        <ul className="phone-kit phone-msg-group" aria-label="Conversas">
          {visiveis.map((c) => (
            <li key={c.cliente_id} className="phone-msg-row">
              <button
                type="button"
                className="phone-msg-row__main"
                data-testid={`conversa-${c.cliente_id}`}
                onClick={() => onSelect(c.cliente_id)}
              >
                <ClienteAvatar
                  nome={c.cliente_nome}
                  fotoUrl={c.cliente_foto_url}
                  cliente={clientesById.get(c.cliente_id)}
                  size="lg"
                />
                <span className="phone-msg-row__body">
                  <span className="phone-msg-row__line">
                    <span className="phone-msg-row__name">{c.cliente_nome}</span>
                    {c.last_created_at != null && (
                      <span className="phone-msg-row__time">{formatTime(c.last_created_at)}</span>
                    )}
                  </span>
                  <span className="phone-msg-row__line">
                    <span className="phone-msg-row__preview">{conversaPreview(c)}</span>
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
