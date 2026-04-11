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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !bootstrap) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <p className="text-lg font-medium">Link inválido ou expirado.</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!bootstrap.is_active) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <p className="text-lg font-medium">Acesso desativado.</p>
        <p className="text-sm text-muted-foreground">Entre em contato com a agência.</p>
      </div>
    );
  }

  return (
    <HubContext.Provider value={{ bootstrap, token: token!, workspace: workspace! }}>
      <style>{`:root { --brand-color: ${bootstrap.workspace.brand_color}; }`}</style>
      <div className="min-h-screen bg-background flex flex-col">
        <HubNav />
        <main className="flex-1 container mx-auto px-4 py-6 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>
    </HubContext.Provider>
  );
}
