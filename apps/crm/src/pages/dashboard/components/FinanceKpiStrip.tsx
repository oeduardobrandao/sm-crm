import { useTranslation } from 'react-i18next';
import { ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp } from 'lucide-react';
import { formatBRL } from '../../../store';
import { StatCard, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';

interface Props {
  aReceber: number;
  aPagar: number;
  saldoProjetado: number;
  receitaMensal: number;
}

export function FinanceKpiStrip({ aReceber, aPagar, saldoProjetado, receitaMensal }: Props) {
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
      value: formatBRL(aReceber),
      color: 'var(--success)',
      icon: ArrowDownCircle,
      tone: 'green',
    },
    {
      label: t('kpi.aPagar'),
      value: formatBRL(aPagar),
      color: 'var(--danger)',
      icon: ArrowUpCircle,
      tone: 'red',
    },
    { label: t('kpi.saldo'), value: formatBRL(saldoProjetado), icon: Wallet, tone: 'blue' },
    {
      label: t('kpi.receitaMensal'),
      value: formatBRL(receitaMensal),
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
