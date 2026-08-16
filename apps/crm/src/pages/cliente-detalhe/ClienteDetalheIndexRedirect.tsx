import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Index route for /clientes/:id. Picks the landing tab based on OAuth
 * callback query params — `ig_connected`, `ig_error`, `tt_error` route to
 * Redes sociais, everything else to Visão geral — and preserves the rest of
 * the query string either way.
 *
 * This only decides the REDIRECT TARGET. Processing those params (toasts,
 * the off-Meta dialog) is out of scope here — that logic belongs wherever the
 * Redes sociais tab ends up living, added in a later task of this plan.
 */
export default function ClienteDetalheIndexRedirect() {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();

  const params = new URLSearchParams(search);
  const hasOAuthCallback =
    params.has('ig_connected') || params.has('ig_error') || params.has('tt_error');
  const targetTab = hasOAuthCallback ? 'redes-sociais' : 'visao-geral';

  return <Navigate to={`/clientes/${id}/${targetTab}${search}`} replace />;
}
