import { useEffect, useRef, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HubContext } from '../HubContext';
import { HubSidebar } from './HubSidebar';
import { HubMobileNav } from './HubMobileNav';
import { useTheme } from '../hooks/useTheme';
import { PoweredByMesaas } from '../components/PoweredByMesaas';
import {
  resolveHubTheme,
  buildGoogleFontsHref,
  DEFAULT_HUB_THEME,
  type HubThemeConfig,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
} from '../theme';
import { fetchBootstrap } from '../api';
import type { HubBootstrap } from '../types';

const FONT_LINK_ID = 'hub-custom-fonts';

export function HubShell() {
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<HubBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme, toggleTheme, setTheme, hasStoredPreference } = useTheme();
  const ht = bootstrap?.hub_theme;
  // Defense in depth: hub-bootstrap already fails closed (serves NEUTRAL_HUB_THEME
  // when the workspace isn't entitled), but the client must not trust a `hub_theme`
  // object's preset fields (surface/font_display/font_body/radius/card_style)
  // whenever `customized` reads false — only `customized: true` unlocks them. This
  // keeps the neutral render pixel-identical even if a future bug (or a stale/
  // tampered payload) ever sends non-default fields alongside customized: false.
  const isCustomized = ht?.customized ?? false;
  const appliedDefaultAppearance = useRef(false);

  useEffect(() => {
    if (!workspace || !token) return;
    fetchBootstrap(workspace, token)
      .then(setBootstrap)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace, token]);

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
    const displayId = isCustomized
      ? (ht?.font_display ?? DEFAULT_HUB_THEME.fontDisplay)
      : DEFAULT_HUB_THEME.fontDisplay;
    const bodyId = isCustomized
      ? (ht?.font_body ?? DEFAULT_HUB_THEME.fontBody)
      : DEFAULT_HUB_THEME.fontBody;
    const href = buildGoogleFontsHref(displayId, bodyId);
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
  }, [isCustomized, ht?.font_display, ht?.font_body]);

  // First visit adopts the agency's configured default appearance; an explicit
  // client choice (a value already in localStorage) always wins on later visits.
  // Guarded by a ref so this only ever fires once per mount, the first time
  // bootstrap resolves — not on every subsequent render.
  useEffect(() => {
    if (appliedDefaultAppearance.current || !bootstrap) return;
    appliedDefaultAppearance.current = true;
    if (!hasStoredPreference && ht?.default_appearance === 'dark') {
      setTheme('dark');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, hasStoredPreference, ht?.default_appearance]);

  if (loading) {
    return (
      <div className="hub-root min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-stone-300 border-t-stone-900" />
      </div>
    );
  }

  if (error || !bootstrap) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium hub-txt">{t('hub.invalidLink')}</p>
        <p className="text-sm hub-tx2">{error}</p>
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

  const config: HubThemeConfig =
    isCustomized && ht
      ? {
          accent: bootstrap.workspace.brand_color,
          surface: ht.surface as HubSurface,
          fontDisplay: ht.font_display,
          fontBody: ht.font_body,
          radius: ht.radius as HubRadius,
          cardStyle: ht.card_style as HubCardStyle,
          customized: true,
        }
      : { ...DEFAULT_HUB_THEME, accent: bootstrap.workspace.brand_color };

  const resolved = resolveHubTheme(config, theme === 'dark');
  const styleText = Object.entries(resolved.vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

  return (
    <HubContext.Provider
      value={{ bootstrap, token: token!, workspace: workspace!, theme, toggleTheme }}
    >
      <style>{`:root { ${styleText} }`}</style>
      <div className="hub-root min-h-screen flex flex-col">
        <HubSidebar />
        <HubMobileNav />
        <main className="hub-noise flex-1 md:pl-[240px]">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-8 sm:py-12 pb-28 md:pb-16">
            <Outlet />
            {!ht?.hide_branding && <PoweredByMesaas />}
          </div>
        </main>
      </div>
    </HubContext.Provider>
  );
}
