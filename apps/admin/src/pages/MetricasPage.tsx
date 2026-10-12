import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import { PhoneIconButton, SegmentedControl } from '@mesaas/ios-kit';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { useIsPhone } from '../hooks/useIsPhone';
import { backfillMetrics, type AdminApiError } from '../lib/api';
import { DepositsSection } from './metricas/DepositsSection';
import { RevenueSection } from './metricas/RevenueSection';
import { MovementSection } from './metricas/MovementSection';
import { METRICS_HISTORY_KEY } from './metricas/useMetricsHistory';
import { backfillToastMessage } from './metricas/metrics-view';

const BACKFILL_CONFIRM =
  'Reconstruir o histórico a partir da Stripe e do Pagar.me? Meses já gravados pelo fechamento diário não são alterados.';

/** The page's sections. `id` is the URL hash, so `/metricas#mrr` (Dashboard tiles) deep-links. */
const SECTIONS = [
  { id: 'mrr', label: 'Receita', phoneLabel: 'Receita' },
  { id: 'churn', label: 'Movimento e churn', phoneLabel: 'Churn' },
  { id: 'depositos', label: 'Depósitos', phoneLabel: 'Depósitos' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function sectionFromHash(hash: string): SectionId {
  return SECTIONS.find((s) => `#${s.id}` === hash)?.id ?? 'mrr';
}

/**
 * Métricas: MRR/churn history (sub-project B) and the live Depósitos panel (A), one section at
 * a time. Spec: docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md.
 */
export default function MetricasPage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const section = sectionFromHash(hash);

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

  const onBackfill = () => {
    if (window.confirm(BACKFILL_CONFIRM)) backfill.mutate();
  };

  // replace: switching sections must not stack history entries (Back would cycle the tabs).
  const select = (id: SectionId) => navigate({ hash: `#${id}` }, { replace: true });

  const tabs = (
    <SegmentedControl
      aria-label="Seção"
      semantics="tablist"
      value={section}
      onChange={select}
      options={SECTIONS.map((s) => ({
        value: s.id,
        label: isPhone ? s.phoneLabel : s.label,
        ariaLabel: s.label,
        id: `metricas-tab-${s.id}`,
        controls: s.id,
      }))}
    />
  );

  return (
    <div>
      <PageHeader
        title="Métricas"
        description="Receita, repasses e evolução da plataforma"
        actions={
          <>
            {tabs}
            <Button variant="outline" size="sm" disabled={backfill.isPending} onClick={onBackfill}>
              <History />
              {backfill.isPending ? 'Reconstruindo...' : 'Reconstruir histórico'}
            </Button>
          </>
        }
        phoneActions={
          <PhoneIconButton
            label="Reconstruir histórico"
            disabled={backfill.isPending}
            onClick={onBackfill}
          >
            <History size={18} aria-hidden="true" />
          </PhoneIconButton>
        }
      >
        {isPhone ? tabs : null}
      </PageHeader>
      <section
        key={section}
        id={section}
        role="tabpanel"
        aria-labelledby={`metricas-tab-${section}`}
        className="scroll-mt-6"
      >
        {section === 'mrr' ? (
          <RevenueSection />
        ) : section === 'churn' ? (
          <MovementSection />
        ) : (
          <DepositsSection />
        )}
      </section>
    </div>
  );
}
