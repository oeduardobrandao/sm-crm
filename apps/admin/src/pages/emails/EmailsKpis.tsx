import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { BOUNCE_ALERT, COMPLAINT_ALERT, formatRate, type EmailView } from './email-metrics-view';

/** Enviados / entrega / bounce / reclamações; bounce and complaint go red past their thresholds. */
export function EmailsKpis({ kpis }: { kpis: EmailView['kpis'] }) {
  const bounceAlert = kpis.bounce !== null && kpis.bounce > BOUNCE_ALERT;
  const complaintAlert = kpis.complaint !== null && kpis.complaint > COMPLAINT_ALERT;
  return (
    <KpiGrid>
      <KpiTile
        label="Enviados"
        value={<span data-testid="email-kpi-sent">{kpis.sent.toLocaleString('pt-BR')}</span>}
      />
      <KpiTile
        label="Taxa de entrega"
        value={<span data-testid="email-kpi-delivery">{formatRate(kpis.delivery)}</span>}
      />
      <div data-alert={bounceAlert ? 'true' : undefined} data-testid="email-kpi-bounce-card">
        <KpiTile
          label="Taxa de bounce"
          tone={bounceAlert ? 'danger' : 'default'}
          value={<span data-testid="email-kpi-bounce">{formatRate(kpis.bounce)}</span>}
          sub={`${kpis.bounced.toLocaleString('pt-BR')} bounces`}
        />
      </div>
      <div data-alert={complaintAlert ? 'true' : undefined} data-testid="email-kpi-complaint-card">
        <KpiTile
          label="Reclamações"
          tone={complaintAlert ? 'danger' : 'default'}
          value={<span data-testid="email-kpi-complaint">{formatRate(kpis.complaint)}</span>}
          sub={`${kpis.complained.toLocaleString('pt-BR')} reclamações`}
        />
      </div>
    </KpiGrid>
  );
}
