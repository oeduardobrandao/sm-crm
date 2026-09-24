import { PageHeader } from '../components/PageHeader';
import { DepositsSection } from './metricas/DepositsSection';

/**
 * Métricas: charts and money views for the platform. Sub-project A ships only the Depósitos
 * section; B adds the MRR/churn chart sections above it and links the Dashboard tiles here
 * by anchor (see docs/superpowers/specs/2026-09-24-admin-depositos-design.md).
 */
export default function MetricasPage() {
  return (
    <div>
      <PageHeader title="Métricas" description="Receita, repasses e evolução da plataforma" />
      <section id="depositos" aria-labelledby="depositos-title" className="scroll-mt-6">
        <h2 id="depositos-title" className="font-sf text-lg font-semibold mb-4">
          Depósitos
        </h2>
        <DepositsSection />
      </section>
    </div>
  );
}
