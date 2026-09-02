import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UserX, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { getCliente, getInitials } from '../../store';
import { useAuth } from '../../context/AuthContext';
import { ClienteDetalheHeader } from './ClienteDetalheHeader';
import { ClienteDetalheNav } from './ClienteDetalheNav';
import { ClienteEditDialog } from './ClienteEditDialog';
import {
  CLIENTE_TABS,
  canAccessClienteTab,
  financeiroTabGuardOutcome,
  type ClienteDetalheOutletContext,
} from './clienteTabs.model';

function CenteredSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <Spinner size="lg" />
    </div>
  );
}

/**
 * Shell for /clientes/:id/*: loads the client, renders the header + tab nav,
 * and hands `{ clienteId, cliente }` to whichever tab route matched via
 * `<Outlet context>`. Mirrors ConfiguracaoLayout's gating order (loading ->
 * membershipResolved branches -> per-tab access check) rather than inventing
 * new logic — see clienteTabs.model.ts for the tab list and access rules.
 */
export default function ClienteDetalhePage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, workspaceRole, membershipResolved, canSeeFinancials, can, loading } = useAuth();
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);

  const clienteId = parseInt(idParam ?? '', 10);
  const validId = !isNaN(clienteId);

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [loading, user, navigate]);

  // Hooks must run unconditionally regardless of the guards below, so this
  // query is declared before any early return; `enabled` just no-ops it for
  // an invalid id.
  const { data: cliente, isLoading: loadingCliente } = useQuery({
    queryKey: ['cliente', clienteId],
    queryFn: () => getCliente(clienteId),
    enabled: validId,
  });

  if (!validId) {
    return <Navigate to="/clientes" replace />;
  }

  // Wait for the session/profile before deciding anything: rendering the
  // shell early would flash the agent-sized tab set at an owner, and the
  // guard below would bounce them off a tab they are allowed to see.
  if (loading || !user) {
    return <CenteredSpinner />;
  }

  // `workspaceRole` is null here in two DIFFERENT real cases, and
  // `membershipResolved` is what tells them apart — see AuthContext.tsx and
  // ConfiguracaoLayout.tsx, which this mirrors exactly.
  if (workspaceRole === null && membershipResolved === true) {
    return (
      <div className="page-content">
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <UserX size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Sem acesso a este workspace</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Você não tem mais acesso a este workspace. Fale com o proprietário se acha que isso é um
            engano.
          </p>
        </div>
      </div>
    );
  }

  if (workspaceRole === null) {
    return (
      <div className="page-content">
        <div className="card" style={{ maxWidth: 480, margin: '3rem auto', textAlign: 'center' }}>
          <AlertTriangle size={40} style={{ color: 'var(--warning)', marginBottom: '1rem' }} />
          <h3 style={{ marginBottom: '0.75rem' }}>Não foi possível confirmar seu acesso</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Houve um problema ao verificar seu acesso a este workspace. Isso costuma ser temporário
            — tente novamente.
          </p>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Validate the ENTIRE remaining path, not just its first segment: a known
  // tab prefix with a bogus nested segment (e.g. /clientes/42/relatorios/x)
  // must redirect too, or it falls through to App.tsx's catch-all `*` route
  // under /clientes/:id and renders a blank content pane.
  const current = pathname.replace(/^\/clientes\/[^/]+\/?/, '').replace(/\/+$/, '');

  // Unknown segment: not one of the seven registered tabs (and not the empty
  // index segment, which has its own route/component).
  if (current && !CLIENTE_TABS.some((tab) => tab.key === current)) {
    return <Navigate to={`/clientes/${clienteId}/visao-geral`} replace />;
  }

  if (current === 'financeiro') {
    // Three-state guard, resolved BEFORE the Outlet (and therefore
    // FinanceiroTab) mounts in this same render — never mount-then-redirect
    // via an effect, which would let a financial query fire first.
    const outcome = financeiroTabGuardOutcome(canSeeFinancials);
    if (outcome === 'loading') return <CenteredSpinner />;
    if (outcome === 'denied') {
      return <Navigate to={`/clientes/${clienteId}/visao-geral`} replace />;
    }
  } else if (current && !canAccessClienteTab(current, can)) {
    return <Navigate to={`/clientes/${clienteId}/visao-geral`} replace />;
  }

  if (loadingCliente) {
    return <CenteredSpinner />;
  }

  if (!cliente) {
    return (
      <div className="card" style={{ margin: '2rem', textAlign: 'center', padding: '3rem' }}>
        <h2>{t('detail.notFound')}</h2>
        <Button onClick={() => navigate('/clientes')} style={{ marginTop: 16 }}>
          {tc('actions.back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="cliente-detalhe-page">
      <ClienteDetalheHeader
        clienteId={clienteId}
        nome={cliente.nome}
        initials={getInitials(cliente.nome)}
        cor={cliente.cor}
        plano={cliente.plano}
        status={cliente.status}
        imageUrl={cliente.foto_url}
        canEditPhoto={workspaceRole === 'owner' || workspaceRole === 'admin'}
        onBack={() => navigate('/clientes')}
        onEdit={() => setEditOpen(true)}
      />

      <div className="cliente-tabs-shell">
        <ClienteDetalheNav clienteId={clienteId} cliente={cliente} />
        <div className="cliente-tabs-content">
          <Outlet context={{ clienteId, cliente } satisfies ClienteDetalheOutletContext} />
        </div>
      </div>

      <ClienteEditDialog cliente={cliente} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
