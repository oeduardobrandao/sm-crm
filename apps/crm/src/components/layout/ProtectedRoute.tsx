// Shell-only CSS (Phosphor, app.css, Vidro) rides this lazy chunk instead of the entry's
// render-blocking stylesheet, so the public pages never download it.
import '@/styles/app-shell';
import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { PageSkeleton } from '@/components/ui/skeletons';
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';
import { resolveRouteGate } from './routePermissions';
import { isLayoutGuardedPath } from './AppLayout';
import { useTrialOfferRedirect } from './useTrialOfferRedirect';

const FEATURE_GATED: Record<string, { flag: string; label: string }> = {
  '/analytics': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/analytics-fluxos': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/relatorios': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/leads': { flag: 'feature_leads', label: 'Leads' },
  '/financeiro': { flag: 'feature_financial', label: 'Financeiro' },
  '/contratos': { flag: 'feature_contracts', label: 'Contratos' },
  '/ideias': { flag: 'feature_ideas', label: 'Ideias' },
  '/post-express': { flag: 'feature_post_scheduling', label: 'Agendamento de Posts' },
};

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, role, can, loading } = useAuth();
  const location = useLocation();
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  // Hook order: this must stay above every early return below.
  const trialOffer = useTrialOfferRedirect(location.pathname.toLowerCase());

  if (loading || limitsLoading) {
    // The shell (sidebar, top bar) is not mounted yet and the page is unknown, so this is a
    // content-only silhouette padded like `.main-content`.
    return (
      <PageSkeleton
        style={{
          minHeight: '100vh',
          padding: 'clamp(1.25rem, 3vw, 2.5rem) clamp(1rem, 3vw, 3rem)',
        }}
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // App.tsx declares routes lowercase with no `caseSensitive`, so React Router
  // matches `/Financeiro` to the same page as `/financeiro`. Lowercase the
  // pathname before matching here too, or a capitalized URL bypasses both the
  // feature gate and the permission gate below.
  const pathname = location.pathname.toLowerCase();

  // Permission gate runs BEFORE the feature-gate loop below, on purpose: this
  // restores the ordering the pre-permission-model `AGENT_BLOCKED` check had
  // (it ran before FEATURE_GATED too). With the loop first, a role without
  // access to a route that is ALSO feature-gated (e.g. an agent at `/leads`
  // on a plan with `feature_leads` off) would see the upgrade screen instead
  // of being redirected -- a regression nothing exercised before this file
  // grew a `can()`-based gate. See ProtectedRoute.test.tsx's "ordering" test.
  //
  // `/financeiro` and `/contratos` are EXEMPT from this gate entirely: they
  // are `AppLayout`'s territory, via its own three-state guards
  // (`financialGuardOutcome` / `contractGuardOutcome`, content/loading/denied
  // -> `FinancialRestrictionScreen`), which already fully decide access for
  // EVERY role -- including a restricted admin, who this gate would
  // otherwise redirect to /dashboard, silently replacing that dedicated
  // screen with a bare bounce. Each of the two now reads its OWN capability
  // (`financeiro:ver` / `contratos:ver`); letting `resolveRouteGate` still
  // classify both paths keeps `nav-data.ts` and the route table honest, and
  // only the ENFORCEMENT here is skipped. See `isLayoutGuardedPath` in
  // `AppLayout.tsx`.
  if (!isLayoutGuardedPath(pathname)) {
    const gate = resolveRouteGate(pathname);
    if (gate === 'unmapped') {
      if (import.meta.env.DEV) {
        console.error(`[ProtectedRoute] rota sem entrada no mapa de permissões: ${pathname}`);
      }
      return <Navigate to="/dashboard" replace />;
    }
    if (gate !== 'open') {
      const allowed = can(gate.module, gate.action);
      // 'unknown' falha NEUTRO (render): igual ao guard financeiro do AppLayout.
      if (allowed === false) return <Navigate to="/dashboard" replace />;
    }
  }

  // /mensagens abriga dois recursos gateados separadamente (chat com
  // clientes + chat de equipe): bloqueia so quando AMBAS as flags estao off.
  // feature_team_chat usa `!== true` (fail-closed) em vez de `=== false`
  // (fail-open, como feature_mensagens): ate o redeploy de workspace-limits
  // que passa a devolver essa coluna nova, ela chega `undefined` para todo
  // workspace. Com `=== false` o bloqueio nunca dispararia nessa janela e
  // /mensagens ficaria destravada mesmo com feature_mensagens:false -- uma
  // regressao do paywall hoje em producao.
  if (
    !isUnlimited &&
    features &&
    pathname.startsWith('/mensagens') &&
    features.feature_mensagens === false &&
    features.feature_team_chat !== true
  ) {
    return <UpgradeLockedScreen featureLabel="Mensagens" feature="feature_mensagens" />;
  }

  if (!isUnlimited && features) {
    for (const [path, { flag, label }] of Object.entries(FEATURE_GATED)) {
      if (pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <UpgradeLockedScreen featureLabel={label} feature={flag} />;
      }
    }
  }

  const needsSetup =
    role === 'owner' &&
    profile !== null &&
    !(profile as any).empresa &&
    location.pathname !== '/workspace-setup';

  if (needsSetup) {
    return <Navigate to="/workspace-setup" replace />;
  }

  if (trialOffer.pending) {
    return (
      <PageSkeleton
        style={{
          minHeight: '100vh',
          padding: 'clamp(1.25rem, 3vw, 2.5rem) clamp(1rem, 3vw, 3rem)',
        }}
      />
    );
  }
  if (trialOffer.redirect) return <Navigate to="/comecar" replace />;

  return <>{children}</>;
}
