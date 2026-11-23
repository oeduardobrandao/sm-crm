import { useCallback, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useTouchSafeToaster } from '@mesaas/ui/toast/touchSafeToaster';
import { useTranslation } from 'react-i18next';
import { HubContext } from '../HubContext';
import { HubSidebar } from './HubSidebar';
import { HubMobileNav } from './HubMobileNav';
import { HubLogin } from './HubLogin';
import { buildHubThemeConfig } from './hubThemeConfig';
import { logoutHub } from '../api';
import { clearHubSession } from '../lib/hubSession';
import { useTheme } from '../hooks/useTheme';
import { PoweredByMesaas } from '../components/PoweredByMesaas';
import { resolveHubTheme, buildGoogleFontsHref, effectiveHubFonts, type HubLook } from '../theme';
import { hubBootstrapQuery, isLoginRequiredError } from '../queries';
import type { HubLoginPayload } from '../types';
import { canonicalHubToken, compactHubToken } from '../lib/hubLinks';
import { ShellSkeleton } from '../components/Skeleton';

const FONT_LINK_ID = 'hub-custom-fonts';

/**
 * The `login` payload of a 401 `login_required` bootstrap error, or null when the error is
 * something else or carries no usable payload (then the invalid-link screen is the safe answer).
 */
function loginPayloadOf(error: unknown): HubLoginPayload | null {
  if (!isLoginRequiredError(error)) return null;
  const login = (error as { body?: { login?: Partial<HubLoginPayload> } }).body?.login;
  const ws = login?.workspace;
  if (!ws || typeof ws.name !== 'string' || typeof ws.brand_color !== 'string') return null;
  return login as HubLoginPayload;
}

export function HubShell() {
  const { workspace, token: urlToken } = useParams<{ workspace: string; token: string }>();
  // The URL carries the compact token (see compactHubToken); the API and the
  // query keys use the hyphenated UUID, which old links still carry.
  const token = urlToken ? canonicalHubToken(urlToken) : undefined;
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  // A tap on a toast must not pause it for good on a phone (see the hook).
  useTouchSafeToaster();

  // An old link (hyphenated token) is rewritten to the compact form in place, so
  // a URL copied from the address bar and pasted in WhatsApp isn't read as Pix.
  useEffect(() => {
    if (!urlToken) return;
    const compact = compactHubToken(canonicalHubToken(urlToken));
    if (compact === urlToken) return;
    navigate(
      { pathname: pathname.replace(`/hub/${urlToken}`, `/hub/${compact}`), search, hash },
      { replace: true },
    );
  }, [urlToken, pathname, search, hash, navigate]);
  // Usually already in flight: main.tsx prefetches it before the page chunk loads.
  const bootstrapQuery = useQuery({
    ...hubBootstrapQuery(workspace ?? '', token ?? ''),
    enabled: !!workspace && !!token,
  });
  const bootstrap = bootstrapQuery.data ?? null;
  const error = bootstrapQuery.error?.message ?? null;
  const loading = bootstrapQuery.isPending;
  // The error is checked BEFORE the data: a mid-session `login_required` (session expired or
  // revoked) must show the login even while an earlier bootstrap is still cached.
  const loginRequired = isLoginRequiredError(bootstrapQuery.error);
  const loginPayload = loginPayloadOf(bootstrapQuery.error);
  const { theme, toggleTheme, setTheme, hasStoredPreference } = useTheme();
  // Branding comes from the login payload while logged out, from the bootstrap otherwise.
  const ht = loginPayload ? loginPayload.hub_theme : bootstrap?.hub_theme;
  const brandColor = loginPayload?.workspace.brand_color ?? bootstrap?.workspace.brand_color;
  // Defense in depth: hub-bootstrap already fails closed (serves NEUTRAL_HUB_THEME
  // when the workspace isn't entitled), but the client must not trust a `hub_theme`
  // object's preset fields (surface/font_display/font_body/radius/card_style)
  // whenever `customized` reads false — only `customized: true` unlocks them. This
  // keeps the neutral render pixel-identical even if a future bug (or a stale/
  // tampered payload) ever sends non-default fields alongside customized: false.
  const isCustomized = ht?.customized ?? false;
  // Same gating as isCustomized above, applied to the four hub_theme fields the
  // resolver doesn't already gate: hide_branding, logo_style, logo_dark_url and
  // default_appearance. customized: false always reads them as their neutral
  // defaults, even if a stale/tampered payload carries contrary values.
  const effectiveHideBranding = isCustomized ? (ht?.hide_branding ?? false) : false;
  // Visual identity flag. HubShell provides HubContext, so it can't use useHubLook.
  // The login payload carries no look flag, so the login screen is always classic.
  const look: HubLook =
    !loginPayload && bootstrap?.feature_hub_pauta === true ? 'pauta' : 'classic';
  const appliedDefaultAppearance = useRef(false);

  useEffect(() => {
    if (!bootstrap?.workspace.logo_url) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = bootstrap.workspace.logo_url;
  }, [bootstrap]);

  // Loads the custom Google Fonts stylesheet only when the workspace picked
  // non-default fonts (buildGoogleFontsHref returns null for the defaults, which
  // are already loaded by index.html) — one shared <link> tag, updated in place
  // when the font choice changes, removed entirely when it reverts to defaults.
  useEffect(() => {
    const fonts = effectiveHubFonts(look, isCustomized, {
      display: ht?.font_display,
      body: ht?.font_body,
    });
    const href = buildGoogleFontsHref(fonts.display, fonts.body);
    const existing = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (href) {
      if (existing) {
        existing.href = href;
      } else {
        const link = document.createElement('link');
        link.id = FONT_LINK_ID;
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
    } else if (existing) {
      existing.remove();
    }
  }, [look, isCustomized, ht?.font_display, ht?.font_body]);

  // First visit adopts the agency's configured default appearance; an explicit
  // client choice (a value already in localStorage) always wins on later visits.
  // Guarded by a ref so this only ever fires once per mount, the first time
  // bootstrap resolves — not on every subsequent render.
  //
  // Applies in BOTH directions (light and dark), not just toward dark: a client
  // auto-persisted to dark by an earlier visit must reset to light once the
  // agency reverts the default appearance, or once the workspace loses
  // customization entirely (hub_theme.customized flips to false) — otherwise
  // they'd be stuck on dark forever. The false-customized case reads
  // default_appearance as the neutral 'light', same gating as isCustomized above.
  // When hub_theme is entirely absent (old deployed function, pre-migration
  // bootstrap), this stays a no-op — there is no default to apply.
  useEffect(() => {
    if (appliedDefaultAppearance.current || !bootstrap) return;
    appliedDefaultAppearance.current = true;
    if (!ht) return;
    const defaultAppearance = isCustomized ? ht.default_appearance : 'light';
    if (!hasStoredPreference && (defaultAppearance === 'light' || defaultAppearance === 'dark')) {
      setTheme(defaultAppearance === 'dark' ? 'dark' : 'light');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, hasStoredPreference, ht, isCustomized]);

  const signOut = useCallback(async () => {
    try {
      await logoutHub();
    } catch {
      // The server copy may linger until it expires; the local sign-out still goes ahead.
    } finally {
      clearHubSession();
      // Drop everything the previous person loaded (a shared device keeps no cached data).
      // Bootstrap goes first: on a gated hub it fails with login_required, the portal unmounts
      // and the rest is simply removed, with no refetch (they would all 401). On an open hub it
      // succeeds and the still-mounted portal needs its queries reset, because removed queries
      // are not refetched by observers that stay mounted.
      await queryClient.invalidateQueries({ queryKey: ['hub-bootstrap'] });
      const others = {
        predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'hub-bootstrap',
      };
      const gated = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['hub-bootstrap'] })
        .some((q) => q.state.status === 'error');
      if (gated) queryClient.removeQueries(others);
      else await queryClient.resetQueries(others);
    }
  }, [queryClient]);

  if (loading) {
    return <ShellSkeleton />;
  }

  if (loginPayload && workspace && token) {
    const loginStyle = Object.entries(
      resolveHubTheme(buildHubThemeConfig(brandColor!, ht), theme === 'dark', 'classic').vars,
    )
      .map(([k, v]) => `${k}: ${v};`)
      .join(' ');
    return (
      <>
        <style>{`:root { ${loginStyle} }`}</style>
        <div className="hub-root min-h-screen flex flex-col">
          <HubLogin
            workspace={workspace}
            token={token}
            login={loginPayload}
            onLoggedIn={() => void queryClient.invalidateQueries()}
          />
        </div>
      </>
    );
  }

  // A refetch error other than login_required keeps the cached portal; only a missing
  // bootstrap (or a login_required with no usable payload) is the invalid-link screen.
  if (loginRequired || !bootstrap) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium hub-txt">{t('hub.invalidLink')}</p>
        {!loginRequired && <p className="text-sm hub-tx2">{error}</p>}
      </div>
    );
  }

  if (!bootstrap.is_active) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium hub-txt">{t('hub.accessDisabled')}</p>
        <p className="text-sm hub-tx2">{t('hub.contactAgency')}</p>
      </div>
    );
  }

  const config = buildHubThemeConfig(bootstrap.workspace.brand_color, ht);

  const resolved = resolveHubTheme(config, theme === 'dark', look);
  const styleText = Object.entries(resolved.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

  return (
    <HubContext.Provider
      value={{
        bootstrap,
        token: token!,
        workspace: workspace!,
        theme,
        toggleTheme,
        person: bootstrap.person ?? null,
        signOut: () => void signOut(),
      }}
    >
      <style>{`:root { ${styleText} }`}</style>
      <div
        className="hub-root min-h-screen flex flex-col"
        data-hub-look={look === 'pauta' ? 'pauta' : undefined}
      >
        <HubSidebar />
        <HubMobileNav />
        {/* Inside .hub-root so the Hub's fonts apply; clears the phone bottom nav. */}
        <Toaster
          position="bottom-center"
          theme={theme === 'dark' ? 'dark' : 'light'}
          mobileOffset={{ bottom: 96 }}
        />
        <main
          className={look === 'pauta' ? 'flex-1 md:pl-[240px]' : 'hub-noise flex-1 md:pl-[240px]'}
        >
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-8 sm:py-12 pb-28 md:pb-16">
            <Outlet />
            {!effectiveHideBranding && <PoweredByMesaas />}
          </div>
        </main>
      </div>
    </HubContext.Provider>
  );
}
