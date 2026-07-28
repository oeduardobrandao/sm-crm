import { useTranslation } from 'react-i18next';
import { ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp } from 'lucide-react';
import { StatCard, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';

interface Props {
  aReceber: number;
  aPagar: number;
  saldoProjetado: number | null;
  receitaMensal: number | null;
  canSeeFinancials: FinancialAccess;
}

export function FinanceKpiStrip({
  aReceber,
  aPagar,
  saldoProjetado,
  receitaMensal,
  canSeeFinancials,
}: Props) {
  const { t } = useTranslation('dashboard');
  const items: {
    label: string;
    value: string;
    color?: string;
    icon: typeof Wallet;
    tone: StatTone;
  }[] = [
    {
      label: t('kpi.aReceber'),
      value: formatFinancialBRL(aReceber, canSeeFinancials),
      color: 'var(--success)',
      icon: ArrowDownCircle,
      tone: 'green',
    },
    {
      label: t('kpi.aPagar'),
      value: formatFinancialBRL(aPagar, canSeeFinancials),
      color: 'var(--danger)',
      icon: ArrowUpCircle,
      tone: 'red',
    },
    {
      label: t('kpi.saldo'),
      value: formatFinancialBRL(saldoProjetado, canSeeFinancials),
      icon: Wallet,
      tone: 'blue',
    },
    {
      label: t('kpi.receitaMensal'),
      value: formatFinancialBRL(receitaMensal, canSeeFinancials),
      icon: TrendingUp,
      tone: 'violet',
    },
  ];
  return (
    <StatCardGrid style={{ marginTop: '1rem' }}>
      {items.map((it) => (
        <StatCard
          key={it.label}
          label={it.label}
          value={it.value}
          valueColor={it.color}
          icon={it.icon}
          tone={it.tone}
          compactValue
        />
      ))}
    </StatCardGrid>
  );
}
