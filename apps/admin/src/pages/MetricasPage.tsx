import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { backfillMetrics, type AdminApiError } from '../lib/api';
import { DepositsSection } from './metricas/DepositsSection';
import { RevenueSection } from './metricas/RevenueSection';
import { MovementSection } from './metricas/MovementSection';
import { METRICS_HISTORY_KEY, useMetricsHistory } from './metricas/useMetricsHistory';
import { backfillToastMessage } from './metricas/metrics-view';

const BACKFILL_CONFIRM =
  'Reconstruir o histórico a partir da Stripe e do Pagar.me? Meses já gravados pelo fechamento diário não são alterados.';

/**
 * Métricas: MRR/churn history (sub-project B) above the live Depósitos panel (A).
 * Spec: docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md.
 */
export default function MetricasPage() {
  const { hash } = useLocation();
  const history = useMetricsHistory();
  const qc = useQueryClient();

  // Dashboard tiles deep-link to #mrr; scroll once the charts have their height.
  useEffect(() => {
    if (!hash || history.isPending) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash, history.isPending]);

  const backfill = useMutation({
    mutationFn: backfillMetrics,
    onSuccess: (report) => {
      toast.success(backfillToastMessage(report));
      qc.invalidateQueries({ queryKey: METRICS_HISTORY_KEY });
    },
    onError: (err) =>
      toast.error(
        (err as AdminApiError).status === 403
          ? 'Disponível só em produção'
          : 'Não foi possível reconstruir o histórico.',
      ),
  });

  return (
    <div>
      <PageHeader
        title="Métricas"
        description="Receita, repasses e evolução da plataforma"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={backfill.isPending}
            onClick={() => {
              if (window.confirm(BACKFILL_CONFIRM)) backfill.mutate();
            }}
          >
            <History />
            {backfill.isPending ? 'Reconstruindo...' : 'Reconstruir histórico'}
          </Button>
        }
      />
      <section id="mrr" aria-labelledby="mrr-title" className="scroll-mt-6 mb-10">
        <h2 id="mrr-title" className="font-sf text-lg font-semibold mb-4">
          Receita recorrente
        </h2>
        <RevenueSection />
      </section>
      <section id="churn" aria-labelledby="churn-title" className="scroll-mt-6 mb-10">
        <h2 id="churn-title" className="font-sf text-lg font-semibold mb-4">
          Movimento e churn
        </h2>
        <MovementSection />
      </section>
      <section id="depositos" aria-labelledby="depositos-title" className="scroll-mt-6">
        <h2 id="depositos-title" className="font-sf text-lg font-semibold mb-4">
          Depósitos
        </h2>
        <DepositsSection />
      </section>
    </div>
  );
}
