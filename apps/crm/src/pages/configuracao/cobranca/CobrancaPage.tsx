import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  startCheckout,
  openBillingPortal,
  type BillingInterval,
} from '@/services/billing';

export default function CobrancaPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: role === 'owner',
  });
  const { data: subscription, refetch: refetchSub } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: role === 'owner',
  });

  // Handle the Checkout return.
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'success') {
      toast.success('Pagamento confirmado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        refetchSub();
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      searchParams.delete('status');
      setSearchParams(searchParams, { replace: true });
      return () => window.clearInterval(id);
    }
    if (status === 'cancelled') {
      toast('Checkout cancelado.');
      searchParams.delete('status');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, refetchSub]);

  if (role !== 'owner') {
    return (
      <div className="card">
        <h1>Plano &amp; Cobrança</h1>
        <p>Apenas o proprietário da conta pode gerenciar a assinatura.</p>
      </div>
    );
  }

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';

  async function handleUpgrade(planId: string) {
    setBusy(planId);
    try {
      window.location.href = await startCheckout(planId, interval);
    } catch (err) {
      toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    try {
      window.location.href = await openBillingPortal();
    } catch (err) {
      toast.error('Erro ao abrir portal: ' + (err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Plano &amp; Cobrança</h1>

      {hasActiveSub && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p>
            Plano atual: <strong>{subscription?.plan_id ?? '—'}</strong>
            {subscription?.cancel_at_period_end ? ' (cancela no fim do ciclo)' : ''}
          </p>
          <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
            {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          className={interval === 'month' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setInterval('month')}
        >
          Mensal
        </button>
        <button
          className={interval === 'year' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setInterval('year')}
        >
          Anual
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '1.5rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {(plans ?? []).map((p) => {
          const price = interval === 'year' ? p.price_brl_annual : p.price_brl;
          const isCurrent = subscription?.plan_id === p.id && hasActiveSub;
          const isFree = p.id === 'free';
          return (
            <div key={p.id} className="kpi-card">
              <h3>{p.name}</h3>
              <p>
                {price != null && price > 0
                  ? `R$ ${price}${interval === 'year' ? '/ano' : '/mês'}`
                  : 'Grátis'}
              </p>
              {isFree ? (
                <span>Plano gratuito</span>
              ) : isCurrent ? (
                <span>Plano atual</span>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => handleUpgrade(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? 'Aguarde…' : 'Fazer upgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
