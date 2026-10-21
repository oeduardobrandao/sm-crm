import { Link } from 'react-router-dom';
import { computeMeterState, METER_FILL } from '@/components/usage/usage-meter-state';
import './entityListPhone.css';

export interface PhoneUsageLineProps {
  /** Plural noun after the numbers ("clientes", "leads"). */
  label: string;
  used: number;
  /** A resolved plan limit: `null` (unlimited) renders nothing, 0 is "not included". */
  limit: number | null;
  /** Ownership gate for the upgrade link: pass useIsWorkspaceOwner(). */
  showUpgradeCta?: boolean;
}

/**
 * The plan-usage line under a phone large title (FClientes, FLeads mockups): a small
 * bar, "12 de 15 clientes" and the owner's "Fazer upgrade" link. Same thresholds and
 * copy as `UsageMeter size="compact"` (one `computeMeterState`), but built from spans
 * so it can sit in the title's subtitle paragraph.
 */
export function PhoneUsageLine({
  label,
  used,
  limit,
  showUpgradeCta = false,
}: PhoneUsageLineProps) {
  if (limit === null) return null;
  const meter = computeMeterState(used, limit);
  const danger = meter.state === 'danger' || meter.state === 'blocked';
  return (
    <span className="phone-el-usage" data-state={meter.state}>
      {limit > 0 && (
        <span
          className="phone-el-usage__bar"
          role="progressbar"
          aria-label={`Uso do plano: ${label}`}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <span
            className="phone-el-usage__fill"
            style={{ width: `${meter.pct}%`, background: METER_FILL[meter.state] }}
          />
        </span>
      )}
      <span className={danger ? 'phone-el-usage__text--danger' : undefined}>
        {limit > 0 ? `${used} de ${limit} ${label}` : 'Não incluído no plano'}
      </span>
      {showUpgradeCta && meter.showCta && (
        <>
          <span aria-hidden="true">·</span>
          <Link to="/configuracao/cobranca" className="phone-el-usage__cta">
            Fazer upgrade
          </Link>
        </>
      )}
    </span>
  );
}
