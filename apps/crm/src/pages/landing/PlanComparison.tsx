import { Minus } from 'lucide-react';
import { landingContent, type SiteLocale } from '@/content/locale';
import type { PublicPricingPlan } from '@/services/billing';

type CapacityKey =
  | 'max_instagram_accounts'
  | 'storage_quota_bytes'
  | 'max_workflow_templates'
  | 'max_hub_tokens'
  | 'rate_report_generations_per_month';

type FeatureKey =
  | 'feature_post_scheduling'
  | 'feature_tiktok'
  | 'feature_leads'
  | 'feature_financial'
  | 'feature_contracts'
  | 'feature_brand_customization'
  | 'feature_mcp'
  | 'feature_instagram_automation'
  | 'feature_briefing_audio';

export interface PlanComparisonAction {
  href: string;
  label: string;
  primary?: boolean;
}

interface PlanComparisonProps {
  plans: PublicPricingPlan[];
  actionFor: (plan: PublicPricingPlan) => PlanComparisonAction;
  locale?: SiteLocale;
}

const CAPACITY_KEYS: ReadonlyArray<CapacityKey> = [
  'max_instagram_accounts',
  'storage_quota_bytes',
  'max_workflow_templates',
  'max_hub_tokens',
  'rate_report_generations_per_month',
];

/** Limits where 0 means "not part of the plan" (rendered as a dash, not a literal 0). */
const ZERO_IS_NOT_INCLUDED: ReadonlySet<CapacityKey> = new Set([
  'max_hub_tokens',
  'rate_report_generations_per_month',
]);

const FEATURE_KEYS: ReadonlyArray<FeatureKey> = [
  'feature_post_scheduling',
  'feature_tiktok',
  'feature_leads',
  'feature_financial',
  'feature_contracts',
  'feature_brand_customization',
  'feature_mcp',
  'feature_instagram_automation',
  'feature_briefing_audio',
];

function cellClass(plan: PublicPricingPlan): string {
  return `plan-comparison-cell${plan.id === 'pro' ? ' plan-comparison-cell--highlight' : ''}`;
}

/** Empty marker: an em-dash in pt; English copy never uses a dash, so it draws a minus icon. */
function EmptyMark({ locale, label }: { locale: SiteLocale; label: string }) {
  return locale === 'en' ? <Minus size={14} role="img" aria-label={label} /> : <>—</>;
}

function formatStorage(bytes: number | null, locale: SiteLocale, unlimited: string): string {
  if (bytes == null) return unlimited;
  const tag = locale === 'en' ? 'en-US' : 'pt-BR';
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) {
    return `${gigabytes.toLocaleString(tag, { maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2).toLocaleString(tag)} MB`;
}

function CapacityValue({
  plan,
  rowKey,
  locale,
}: {
  plan: PublicPricingPlan;
  rowKey: CapacityKey;
  locale: SiteLocale;
}) {
  const { planComparison, pricing } = landingContent(locale);
  if (rowKey === 'storage_quota_bytes') {
    return <>{formatStorage(plan[rowKey], locale, pricing.unlimited)}</>;
  }
  if (plan[rowKey] === 0 && ZERO_IS_NOT_INCLUDED.has(rowKey)) {
    return <EmptyMark locale={locale} label={planComparison.notIncluded} />;
  }
  return <>{plan[rowKey] == null ? pricing.unlimited : String(plan[rowKey])}</>;
}

function FeatureValue({ included, locale }: { included: boolean; locale: SiteLocale }) {
  const { planComparison } = landingContent(locale);
  return (
    <>
      <span className={included ? 'plan-comparison-check' : 'plan-comparison-empty'} aria-hidden>
        {included ? '✓' : <EmptyMark locale={locale} label={planComparison.notIncluded} />}
      </span>
      <span className="plan-comparison-sr-only">
        {included ? planComparison.included : planComparison.notIncluded}
      </span>
    </>
  );
}

export default function PlanComparison({ plans, actionFor, locale = 'pt' }: PlanComparisonProps) {
  const content = landingContent(locale);
  const t = content.planComparison;
  const popular = content.pricing.popular;
  return (
    <section className="plan-comparison" aria-labelledby="plan-comparison-title">
      <div className="plan-comparison-heading">
        <h3 id="plan-comparison-title">{t.title}</h3>
        <p>{t.sub}</p>
      </div>
      <p className="plan-comparison-swipe-hint" aria-hidden>
        {t.swipeHint}
      </p>
      <div className="plan-comparison-scroll" role="region" aria-label={t.regionLabel} tabIndex={0}>
        <table className="plan-comparison-table">
          <caption className="plan-comparison-sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.featureColumn}</th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className={cellClass(plan)}>
                  <span className="plan-comparison-plan-heading">
                    <span>{plan.name}</span>
                    {plan.id === 'pro' && (
                      <span className="plan-comparison-popular">{popular}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                {t.capacityGroup}
              </th>
            </tr>
            {CAPACITY_KEYS.map((key) => (
              <tr key={key}>
                <th scope="row">{t.capacityRows[key]}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    <CapacityValue plan={plan} rowKey={key} locale={locale} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr className="plan-comparison-group">
              <th scope="rowgroup" colSpan={plans.length + 1}>
                {t.featuresGroup}
              </th>
            </tr>
            {FEATURE_KEYS.map((key) => (
              <tr key={key}>
                <th scope="row">{t.featureRows[key]}</th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cellClass(plan)}>
                    <FeatureValue included={plan[key]} locale={locale} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t.choosePlan}</th>
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
