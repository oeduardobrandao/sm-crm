import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import GlobalSearchDialog from '@/components/layout/GlobalSearchDialog';
import { useTodayCard } from '../useTodayCard';
import { TodayChips, TodayPhone } from './TodayPhone';
import { MinhaFilaPhone } from './MinhaFilaPhone';
import { HealthPhone } from './HealthPhone';
import { AgentPendingPhone } from './AgentPendingPhone';
import './dashboardPhone.css';

interface Props {
  isAgent: boolean;
  /** Trial nudge and WhatsApp cards (non-agents), rendered as they are on desktop. */
  cards: ReactNode;
  /** Import banner and finance KPIs, under the role block. */
  footer: ReactNode;
}

/**
 * Início below 768px (FInicio): page header with the day summary as subtitle, Buscar
 * (global search) and the bell; the "Hoje" bucket chips; Hoje and Minha fila as grouped
 * sections; then client health (or the agent's pending tasks), the import banner and
 * the finance tiles.
 */
export function DashboardPhone({ isAgent, cards, footer }: Props) {
  const today = useTodayCard();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);

  return (
    <div className="phone-home">
      <PhonePageHeader
        title="Início"
        subtitle={today.summary}
        actions={
          <PhoneIconButton
            label="Buscar"
            aria-haspopup="dialog"
            onClick={() => {
              setSearchMounted(true);
              setSearchOpen(true);
            }}
          >
            <Search aria-hidden="true" />
          </PhoneIconButton>
        }
      >
        <TodayChips today={today} />
      </PhonePageHeader>

      <TodayPhone today={today} />
      <MinhaFilaPhone />
      {cards}
      {isAgent ? <AgentPendingPhone /> : <HealthPhone />}
      {footer}

      {searchMounted && <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />}
    </div>
  );
}
