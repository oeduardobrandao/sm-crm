import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { getRentabilidade } from '@/store';
import ConfigSheet from './ConfigSheet';
import OnboardingCard from './OnboardingCard';

const TABS = [
  { to: '/financeiro/rentabilidade', key: 'rentabilidade' },
  { to: '/financeiro/atribuicao', key: 'atribuicao' },
  { to: '/financeiro/equipe', key: 'equipe' },
  { to: '/financeiro/lancamentos', key: 'lancamentos' },
] as const;

/**
 * Title of the v2 screens. Its own component so the page toolbar registration only exists
 * off `lancamentos`: there the ledger (FinanceiroPage) registers its own title and actions,
 * and two registrations at once make the last one win with a dev warning.
 */
function V2Header() {
  const { t } = useTranslation('financeV2');
  const inToolbar = usePageToolbar({ title: t('layout.title') });
  if (inToolbar) return null;
  return (
    <div className="header">
      <div className="header-title">
        <h1>{t('layout.title')}</h1>
      </div>
    </div>
  );
}

/**
 * Shell of /financeiro when Financeiro v2 is on: title, tab bar, the "Configurar" sheet and
 * the onboarding card that stands in for the screens until the seed has run.
 *
 * Children render inside this layout's `.page-content` (do not add another one), except
 * `lancamentos`: it is the legacy ledger, which brings its own `.page-content` and title,
 * so the layout only draws the tab bar above it.
 */
export default function FinanceiroV2Layout() {
  const { t } = useTranslation('financeV2');
  const { can } = useAuth();
  const { pathname } = useLocation();
  const [configOpen, setConfigOpen] = useState(false);
  const canEdit = can('financeiro', 'editar') === true;
  const onLancamentos = /^\/financeiro\/lancamentos\/?$/i.test(pathname);

  const rentabilidade = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', 'atual'],
    queryFn: () => getRentabilidade(),
  });
  const naoMontado = rentabilidade.data?.seeded === false;

  const tabBar = (
    <div className="mb-4 flex items-center gap-2 border-b border-border pb-2">
      <nav aria-label={t('layout.navLabel')} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-sm no-underline',
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )
            }
          >
            {t(`layout.tabs.${tab.key}`)}
          </NavLink>
        ))}
      </nav>
      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          className="mb-0 shrink-0"
          onClick={() => setConfigOpen(true)}
        >
          <Settings aria-hidden="true" />
          {t('layout.configurar')}
        </Button>
      )}
    </div>
  );

  return (
    <>
      {onLancamentos ? (
        <>
          <div className="page-content" style={{ paddingBottom: 0 }}>
            {tabBar}
          </div>
          <Outlet />
        </>
      ) : (
        <div className="page-content">
          <V2Header />
          {tabBar}
          {rentabilidade.isLoading ? null : naoMontado ? (
            <OnboardingCard canEdit={canEdit} />
          ) : (
            <Outlet />
          )}
        </div>
      )}
      {canEdit && <ConfigSheet open={configOpen} onOpenChange={setConfigOpen} />}
    </>
  );
}
