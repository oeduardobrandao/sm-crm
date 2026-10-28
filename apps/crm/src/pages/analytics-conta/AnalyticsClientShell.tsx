import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DetailSkeleton } from '@/components/ui/skeletons';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getClientes } from '../../store';
import { getInstagramSummary } from '../../services/instagram';
import { getTikTokSummary } from '../../services/tiktok';
import { Avatar } from '../analytics/phone/shared';
import { InstagramAnalyticsTab } from './AnalyticsContaPage';
import { ContaPhoneMessage } from './phone/ContaPhone';
import { ClientReportsPanel } from './reports/ClientReportsPanel';

const ANALYTICS_TABS = ['instagram', 'tiktok', 'relatorios'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

const isAnalyticsTab = (v: string | undefined): v is AnalyticsTab =>
  (ANALYTICS_TABS as readonly string[]).includes(v ?? '');

/**
 * Default tab for `/analytics/:id` (and an unknown `:tab`): TikTok only when the client has
 * TikTok connected, no Instagram, and the workspace has `feature_tiktok`. An Instagram token
 * that expired still counts as connected, so it lands on Instagram and its reconnect state.
 */
export function defaultAnalyticsTab({
  igConnected,
  ttConnected,
  tiktokEnabled,
}: {
  igConnected: boolean;
  ttConnected: boolean;
  tiktokEnabled: boolean;
}): AnalyticsTab {
  return !igConnected && ttConnected && tiktokEnabled ? 'tiktok' : 'instagram';
}

const httpsOnly = (url: string | null | undefined) =>
  url && url.startsWith('https://') ? url : null;

/**
 * `/analytics/:id/:tab?`: the client analytics page. Owns the client lookup, the header
 * (back to /analytics, photo, name, specialty) and the Instagram | TikTok | Relatórios tabs;
 * each tab owns its own data and period controls (spec §A6). The only registrant of the
 * Vidro toolbar on this page: the tabs never call usePageToolbar.
 */
export default function AnalyticsClientShell() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('analyticsTiktok');
  const isPhone = !useIsDesktop(768);
  const clientId = parseInt(id ?? '', 10);
  const validId = !isNaN(clientId) && clientId > 0;

  const { features, isLoading: loadingLimits } = useWorkspaceLimits();
  const tiktokEnabled = features?.feature_tiktok === true;

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });
  const cliente = validId ? clientes.find((c) => c.id === clientId) : undefined;

  // Same key and options as the Instagram tab's own query, so they share one request.
  const igQuery = useQuery({
    queryKey: ['ig-summary', clientId],
    queryFn: () => getInstagramSummary(clientId),
    enabled: validId && !!cliente,
  });
  // An error (404 included) means "not connected". No retries: the default tab waits on it.
  const ttQuery = useQuery({
    queryKey: ['tt-summary', clientId],
    queryFn: () => getTikTokSummary(clientId),
    enabled: validId && !!cliente && tiktokEnabled,
    retry: false,
  });

  const nome = cliente?.nome ?? '';
  const especialidade = cliente?.especialidade?.trim() || null;
  const photoSrcs = [
    cliente?.foto_url,
    igQuery.data?.account?.profile_picture_url,
    ttQuery.data?.account?.avatar_url,
  ];
  const photo = photoSrcs.map(httpsOnly).find(Boolean) ?? null;
  // Same initials ContaPhone's identity shows.
  const initials = nome.slice(0, 2).toUpperCase();
  const avatar = photo ? (
    <img src={photo} alt="" className="conta-identity__avatar" />
  ) : (
    <span
      className="conta-identity__avatar inline-flex items-center justify-center font-semibold"
      style={{ background: cliente?.cor || 'var(--surface-2)', color: '#fff' }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
  const backLink = (
    <Button variant="outline" asChild>
      <Link to="/analytics">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
    </Button>
  );

  const inToolbar = usePageToolbar(
    cliente && !isPhone
      ? {
          leading: avatar,
          title: cliente.nome,
          subtitle: especialidade ?? undefined,
          actions: backLink,
        }
      : null,
  );

  if (!validId) {
    if (isPhone) return <ContaPhoneMessage title="ID de cliente inválido." />;
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>ID de cliente inválido.</p>
      </div>
    );
  }

  if (loadingClientes) return <DetailSkeleton />;

  if (!cliente) {
    if (isPhone) return <ContaPhoneMessage title="Cliente não encontrado." />;
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>Cliente não encontrado.</p>
      </div>
    );
  }

  // TikTok tab without the plan: back to Instagram, but only once the plan is known.
  if (tab === 'tiktok') {
    if (loadingLimits) return <DetailSkeleton />;
    if (!tiktokEnabled) return <Navigate to={`/analytics/${clientId}/instagram`} replace />;
  }

  if (!isAnalyticsTab(tab)) {
    // Choose only once every input is settled, or a slow summary flips the choice later.
    const settled = !loadingLimits && !igQuery.isLoading && !(tiktokEnabled && ttQuery.isLoading);
    if (!settled) return <DetailSkeleton />;
    const igConnected =
      !!igQuery.data ||
      (igQuery.error instanceof Error && igQuery.error.message === 'TOKEN_EXPIRED');
    const target = defaultAnalyticsTab({
      igConnected,
      ttConnected: !!ttQuery.data,
      tiktokEnabled,
    });
    return <Navigate to={`/analytics/${clientId}/${target}`} replace />;
  }

  const visibleTabs = ANALYTICS_TABS.filter((k) => k !== 'tiktok' || tiktokEnabled);
  const tabLabel = (k: AnalyticsTab) =>
    k === 'instagram'
      ? t('tab.instagram', 'Instagram')
      : k === 'tiktok'
        ? t('tab.tiktok', 'TikTok')
        : t('tab.reports', 'Relatórios');

  if (isPhone) {
    const tabsControl = (
      <SegmentedControl
        semantics="tablist"
        aria-label="Analytics"
        className="analytics-phone-tabs"
        options={visibleTabs.map((k) => ({ value: k, label: tabLabel(k) }))}
        value={tab}
        onChange={(k) => navigate(`/analytics/${clientId}/${k}`)}
      />
    );
    if (tab === 'instagram') {
      return <InstagramAnalyticsTab clientId={clientId} cliente={cliente} tabs={tabsControl} />;
    }
    return (
      <div className="phone-kit phone-an">
        <PhoneNavBar fallbackTo="/analytics" backLabel="Voltar" />
        <div className="phone-an-identity">
          <Avatar src={photoSrcs} initials={initials} color={cliente.cor} large />
          <div className="phone-an-identity__text">
            <h1 className="phone-an-identity__name">{cliente.nome}</h1>
            {especialidade && <p className="phone-an-identity__meta">{especialidade}</p>}
          </div>
        </div>
        {tabsControl}
        {tab === 'tiktok' ? <TikTokTabPending /> : <ClientReportsPanel clientId={clientId} />}
      </div>
    );
  }

  let content: ReactNode;
  if (tab === 'instagram')
    content = <InstagramAnalyticsTab clientId={clientId} cliente={cliente} />;
  else if (tab === 'tiktok') content = <TikTokTabPending />;
  else content = <ClientReportsPanel clientId={clientId} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {!inToolbar && (
        <header className="header header--flush animate-up">
          <div className="header-title">
            <div className="conta-identity conta-identity--avatar">
              <div className="conta-identity__row">
                {avatar}
                <h1>{cliente.nome}</h1>
              </div>
              {especialidade && <p className="conta-identity__handle">{especialidade}</p>}
            </div>
          </div>
          <div className="header-actions">{backLink}</div>
        </header>
      )}

      <nav className="analytics-tabs animate-up" aria-label="Analytics">
        {visibleTabs.map((k) => (
          <NavLink key={k} to={`/analytics/${clientId}/${k}`} className="analytics-tab" end>
            {tabLabel(k)}
          </NavLink>
        ))}
      </nav>

      {content}
    </div>
  );
}

/** Placeholder until the TikTok tab lands (Task A8). */
function TikTokTabPending() {
  return <div data-testid="tiktok-tab-pending" />;
}
