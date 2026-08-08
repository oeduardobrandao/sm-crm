import { Link } from 'react-router-dom';
import { computeMeterState, METER_FILL } from './usage-meter-state';

/** Track + fill only. Callers with bespoke layouts (mobile StorageCard) use this. */
export function MeterBar({
  used,
  limit,
  height = 5,
}: {
  used: number;
  limit: number;
  height?: number;
}) {
  const meter = computeMeterState(used, limit);
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: 'var(--surface-2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 999,
          width: `${meter.pct}%`,
          background: METER_FILL[meter.state],
          transition: 'width .3s',
        }}
      />
    </div>
  );
}

interface UsageMeterProps {
  label: string;
  used: number;
  /** null = unlimited (resolver semantics). 0 = blocked (fail-closed). */
  limit: number | null;
  size?: 'full' | 'compact';
  format?: (n: number) => string;
  /** Ownership gate for the CTA: pass useIsWorkspaceOwner(). ANDed with showCta. */
  showUpgradeCta?: boolean;
  /** Overrides "{used} de {limit}" (Equipe preview copy). */
  valueText?: string;
  /** Overrides the default remaining text. */
  subText?: string;
  /** false hides the Ilimitado badge (Arquivos quota_bytes:0 = unknown, not unlimited). */
  unlimitedBadge?: boolean;
}

/**
 * Purely presentational: render it only with a RESOLVED limit. Unknown or
 * unavailable limits are the caller's job (see spec §3) — never map them to null.
 */
export function UsageMeter({
  label,
  used,
  limit,
  size = 'full',
  format = String,
  showUpgradeCta = false,
  valueText,
  subText,
  unlimitedBadge = true,
}: UsageMeterProps) {
  const meter = computeMeterState(used, limit);
  const danger = meter.state === 'danger' || meter.state === 'blocked';
  const cta =
    showUpgradeCta && meter.showCta ? (
      <Link
        to="/configuracao/cobranca"
        style={{
          color: danger ? 'var(--danger-text)' : 'var(--text-main)',
          fontWeight: 600,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        Fazer upgrade
      </Link>
    ) : null;

  if (size === 'compact') {
    if (limit === null) return null;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.78rem',
          color: danger ? 'var(--danger-text)' : 'var(--text-muted)',
        }}
      >
        {limit > 0 && (
          <span style={{ width: 64, flex: 'none' }}>
            <MeterBar used={used} limit={limit} />
          </span>
        )}
        <span>
          {limit > 0 ? `${format(used)} de ${format(limit)} ${label}` : 'Não incluído no plano'}
        </span>
        {cta}
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {meter.state === 'unlimited' ? (
            <>
              {format(used)}{' '}
              {unlimitedBadge && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    border: '1px solid var(--border-color)',
                    borderRadius: 999,
                    padding: '1px 8px',
                    color: 'var(--text-muted)',
                  }}
                >
                  Ilimitado
                </span>
              )}
            </>
          ) : (
            (valueText ?? (limit! > 0 ? `${format(used)} de ${format(limit!)}` : format(used)))
          )}
        </span>
      </div>
      {meter.state !== 'unlimited' && meter.state !== 'blocked' && limit !== null && (
        <MeterBar used={used} limit={limit} />
      )}
      {(meter.state === 'blocked' || subText || cta) && meter.state !== 'unlimited' && (
        <div
          style={{
            marginTop: 5,
            fontSize: '0.72rem',
            color: danger ? 'var(--danger-text)' : 'var(--text-light)',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {meter.state === 'blocked' ? <span>Não incluído no plano</span> : null}
          {subText ? <span>{subText}</span> : null}
          {cta}
        </div>
      )}
    </div>
  );
}
