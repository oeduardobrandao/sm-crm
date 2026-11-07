import { Inbox } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { GlassPanel } from '../../components/shell/GlassPanel';
import type { EmailMetricsRecent } from '../../lib/api';
import { categoryLabel, typeLabel } from './email-metrics-view';

const EVENT_LABELS: Record<string, string> = {
  bounced: 'Bounce',
  complained: 'Reclamação',
  failed: 'Falha',
  suppressed: 'Suprimido',
};

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function EmailsRecentBounces({ recent }: { recent: EmailMetricsRecent[] }) {
  return (
    <GlassPanel title="Bounces e reclamações recentes" titleId="emails-recent-title" flush>
      {recent.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum bounce ou reclamação no período" />
      ) : (
        <ul aria-labelledby="emails-recent-title">
          {recent.map((r, i) => (
            <li
              key={`${r.sent_at}:${i}`}
              className="border-t border-border/60 px-[18px] py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 truncate font-medium">
                  {typeLabel(r.type)}{' '}
                  <span className="font-normal text-muted-foreground">
                    ({categoryLabel(r.category)})
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {DATE_TIME.format(new Date(r.sent_at))}
                </span>
              </div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                <span className="font-semibold text-destructive">
                  {EVENT_LABELS[r.last_event] ?? r.last_event}
                </span>
                {r.recipient_masked ? ` · ${r.recipient_masked}` : ''}
                {r.bounce_type ? ` · ${r.bounce_type}` : ''}
                {r.bounce_message ? ` · ${r.bounce_message}` : ''}
              </div>
              {r.subject ? (
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{r.subject}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
