import type { PublicPricingPlan } from '@/services/billing';

type CapacityKey =
  | 'max_instagram_accounts'
  | 'storage_quota_bytes'
  | 'max_workflow_templates'
  | 'max_hub_tokens';

type FeatureKey =
  | 'feature_analytics_reports'
  | 'feature_post_scheduling'
  | 'feature_leads'
  | 'feature_financial'
  | 'feature_contracts'
  | 'feature_brand_customization'
  | 'feature_mcp';

export interface PlanComparisonAction {
  href: string;
  label: string;
  primary?: boolean;
}

interface PlanComparisonProps {
  plans: PublicPricingPlan[];
  actionFor: (plan: PublicPricingPlan) => PlanComparisonAction;
}

const CAPACITY_ROWS: ReadonlyArray<{ key: CapacityKey; label: string }> = [
  { key: 'max_instagram_accounts', label: 'Contas do Instagram' },
  { key: 'storage_quota_bytes', label: 'Armazenamento' },
  { key: 'max_workflow_templates', label: 'Templates de fluxo' },
  { key: 'max_hub_tokens', label: 'Portais do cliente' },
];

const FEATURE_ROWS: ReadonlyArray<{ key: FeatureKey; label: string }> = [
  { key: 'feature_analytics_reports', label: 'Relatórios e analytics' },
  { key: 'feature_post_scheduling', label: 'Agendamento de posts' },
  { key: 'feature_leads', label: 'Leads' },
  { key: 'feature_financial', label: 'Financeiro' },
  { key: 'feature_contracts', label: 'Contratos' },
  { key: 'feature_brand_customization', label: 'Personalização de marca' },
  { key: 'feature_mcp', label: 'Integração com Claude (MCP)' },
];

function cellClass(plan: PublicPricingPlan): string {
  return `plan-comparison-cell${plan.id === 'pro' ? ' plan-comparison-cell--highlight' : ''}`;
}

function formatStorage(bytes: number | null): string {
  if (bytes == null) return 'Ilimitado';
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) {
    return `${gigabytes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2).toLocaleString('pt-BR')} MB`;
}

function formatCapacity(plan: PublicPricingPlan, key: CapacityKey): string {
  if (key === 'storage_quota_bytes') return formatStorage(plan[key]);
  return plan[key] == null ? 'Ilimitado' : String(plan[key]);
}

function FeatureValue({ included }: { included: boolean }) {
  return (
    <>
      <span className={included ? 'plan-comparison-check' : 'plan-comparison-empty'} aria-hidden>
        {included ? '✓' : '—'}
      </span>
      <span className="plan-comparison-sr-only">{included ? 'Incluído' : 'Não incluído'}</span>
    </>
  );
}

export default function PlanComparison({ plans, actionFor }: PlanComparisonProps) {
  return (
    <section className="plan-comparison" aria-labelledby="plan-comparison-title">
      <div className="plan-comparison-heading">
        <h3 id="plan-comparison-title">Compare os planos</h3>
        <p>Confira os limites e recursos atuais de cada opção.</p>
      </div>
      <p className="plan-comparison-swipe-hint" aria-hidden>
        Deslize para comparar →
      </p>
      <div
        className="plan-comparison-scroll"
        role="region"
        aria-label="Tabela comparativa de planos"
        tabIndex={0}
      >
        <table className="plan-comparison-table">
          <caption className="plan-comparison-sr-only">Comparação detalhada dos planos</caption>
          <thead>
            <tr>
              <th scope="col">Recurso</th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className={cellClass(plan)}>
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                Capacidade
              </th>
            </tr>
            {CAPACITY_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    {formatCapacity(plan, row.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                Recursos
              </th>
            </tr>
            {FEATURE_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    <FeatureValue included={plan[row.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Escolha seu plano</th>
              {plans.map((plan) => {
                const action = actionFor(plan);
                return (
                  <td key={plan.id} className={cellClass(plan)}>
                    <a
                      href={action.href}
                      className={`lp-btn ${action.primary ? 'lp-btn-primary' : 'lp-btn-outline'}`}
                    >
                      {action.label}
                    </a>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
