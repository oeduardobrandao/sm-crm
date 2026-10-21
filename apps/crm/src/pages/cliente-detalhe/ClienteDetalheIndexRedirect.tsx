import { Navigate, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ClienteSectionsIndex } from './phone/ClienteSectionsIndex';
import type { ClienteDetalheOutletContext } from './clienteTabs.model';

/**
 * Index route for /clientes/:id. Picks the landing tab based on OAuth
 * callback query params — `ig_connected`, `ig_error`, `tt_error`,
 * `tt_connected` route to Redes sociais, everything else to Visão geral — and preserves the rest of
 * the query string either way.
 *
 * On phones (below 768px) the index is a screen of its own: the sections list
 * (PLAN F3.1) instead of a redirect. An OAuth callback still goes straight to Redes
 * sociais there, which is where its params are processed.
 *
 * This only decides the REDIRECT TARGET. Processing those params (toasts,
 * the off-Meta dialog) is out of scope here — that logic belongs wherever the
 * Redes sociais tab ends up living, added in a later task of this plan.
 */
export default function ClienteDetalheIndexRedirect() {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  const isPhone = !useIsDesktop(768);
  const outlet = useOutletContext<ClienteDetalheOutletContext | undefined>();

  const params = new URLSearchParams(search);
  const hasOAuthCallback =
    params.has('ig_connected') ||
    params.has('ig_error') ||
    params.has('tt_error') ||
    params.has('tt_connected');

  if (isPhone && !hasOAuthCallback && outlet?.cliente) {
    return <ClienteSectionsIndex cliente={outlet.cliente} onEdit={outlet.onEditCliente} />;
  }

  const targetTab = hasOAuthCallback ? 'redes-sociais' : 'visao-geral';

  return <Navigate to={`/clientes/${id}/${targetTab}${search}`} replace />;
}
