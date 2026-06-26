import { useTranslation } from 'react-i18next';
import { formatBRL } from '../../../store';

interface Props {
  aReceber: number;
  aPagar: number;
  saldoProjetado: number;
  receitaMensal: number;
}

export function FinanceKpiStrip({ aReceber, aPagar, saldoProjetado, receitaMensal }: Props) {
  const { t } = useTranslation('dashboard');
  const items = [
    { label: t('kpi.aReceber'), value: formatBRL(aReceber), color: 'var(--success)' },
    { label: t('kpi.aPagar'), value: formatBRL(aPagar), color: 'var(--danger)' },
    { label: t('kpi.saldo'), value: formatBRL(saldoProjetado), color: undefined },
    { label: t('kpi.receitaMensal'), value: formatBRL(receitaMensal), color: undefined },
  ];
  return (
    <div className="kpi-grid" style={{ marginTop: '1rem' }}>
      {items.map((it) => (
        <div key={it.label} className="kpi-card">
          <span className="kpi-label">{it.label}</span>
          <span className="kpi-value" style={{ fontSize: '1.1rem', color: it.color }}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}
