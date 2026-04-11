import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { HubContext } from '../HubContext';
import { HubNav } from './HubNav';
import { fetchBootstrap } from '../api';
import type { HubBootstrap } from '../types';

export function HubShell() {
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const [bootstrap, setBootstrap] = useState<HubBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        <p className="font-display text-2xl font-medium text-stone-900">Link inválido ou expirado.</p>
        <p className="text-sm text-stone-500">{error}</p>
      </div>
    );
  }

  if (!bootstrap.is_active) {
    return (
      <div className="hub-root min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-medium text-stone-900">Acesso desativado.</p>
        <p className="text-sm text-stone-500">Entre em contato com a agência.</p>
      </div>
    );
  }

  return (
    <HubContext.Provider value={{ bootstrap, token: token!, workspace: workspace! }}>
      <style>{`:root { --brand-color: ${bootstrap.workspace.brand_color}; }`}</style>
      <div className="hub-root min-h-screen flex flex-col">
        <HubNav />
        <main className="hub-noise flex-1">
          <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-8 sm:py-12 pb-28 md:pb-16">
            <Outlet />
          </div>
        </main>
      </div>
    </HubContext.Provider>
  );
}
