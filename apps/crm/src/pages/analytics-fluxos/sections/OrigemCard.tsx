import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { OrigemAgg } from '@/services/workflowAnalytics';
import { formatDiasDecimal, origemLabel } from '../format';
import { SectionCard } from './SectionCard';

/**
 * True when the breakdown is worth a card of its own.
 *
 * A workspace that has never run an agent flow gets one row saying "Humano:
 * everything", which is not a breakdown, it is the total restated. So the card
 * appears once there is something to compare against, or once an agent is
 * genuinely in the mix.
 */
export function temOrigemParaMostrar(origem: OrigemAgg[]): boolean {
  return origem.length >= 2 || origem.some((o) => o.origem === 'agent');
}

export function OrigemCard({ origem }: { origem: OrigemAgg[] }) {
  const { t } = useTranslation('analyticsFlows');
  if (!temOrigemParaMostrar(origem)) return null;

  return (
    <SectionCard title={t('origin.title')} caption={t('origin.caption')}>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('origin.origin')}</th>
              <th>{t('kpi.completed')}</th>
              <th>{t('kpi.avgTime')}</th>
            </tr>
          </thead>
          <tbody>
            {origem.map((linha) => (
              <tr key={linha.origem}>
                <td data-label={t('origin.origin')}>
                  <Badge variant="neutral">{origemLabel(linha.origem)}</Badge>
                </td>
                <td data-label={t('kpi.completed')}>{linha.concluidos}</td>
                <td data-label={t('kpi.avgTime')}>{formatDiasDecimal(linha.tempo_medio_dias)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
