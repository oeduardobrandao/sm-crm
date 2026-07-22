import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HubContext } from '../HubContext';
import { HubSidebar } from './HubSidebar';
import { HubMobileNav } from './HubMobileNav';
import { useTheme } from '../hooks/useTheme';
import { PoweredByMesaas } from '../components/PoweredByMesaas';
import { resolveHubTheme } from '../theme';
import { fetchBootstrap } from '../api';
import type { HubBootstrap } from '../types';

export function HubShell() {
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { t } = useTranslation();
  const [bootstrap, setBootstrap] = useState<HubBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme, toggleTheme } = useTheme();

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

  const resolved = resolveHubTheme(bootstrap.workspace.brand_color, theme === 'dark');
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
            <PoweredByMesaas />
          </div>
        </main>
      </div>
    </HubContext.Provider>
  );
}
