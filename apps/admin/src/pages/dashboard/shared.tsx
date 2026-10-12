import { differenceInCalendarDays } from 'date-fns';
import { Badge } from '../../components/ui/badge';
import { getPlanColor } from '../../lib/plan-colors';
import { describeActivity } from '../workspace-activity';
import type { MrrSummary, TrialsSummary, WorkspaceSummary } from '../../lib/api';
import type { RiskCardProps } from './RiskCard';

export function PlanBadge({ name }: { name: string | null }) {
  if (!name) return <span className="text-dim-foreground">—</span>;
  const color = getPlanColor(name);
  return (
    <Badge variant="neutral" style={{ color, backgroundColor: `${color}26` }}>
      {name}
    </Badge>
  );
}

// created_at is only read when last_activity_at is null ("Nunca"); the "now" fallback keeps
// that branch on the cooling tone in the unlikely case the workspace row wasn't found.
export const activity = (ws: { last_activity_at: string | null; created_at: string | null }) =>
  describeActivity(ws.last_activity_at, ws.created_at ?? new Date().toISOString(), new Date());

export interface TrialEndInfo {
  endLabel: string;
  daysLabel: string | null;
  daysTone: 'danger' | 'warning' | 'muted';
}

/**
 * An end time that has already passed is "expirado", decided by exact timestamp, so a trial that
 * ended earlier *today* (webhook status update still in flight) isn't shown as "expira hoje".
 * For a still-future end, the calendar-day delta distinguishes "expira hoje" (ends later today)
 * from "Nd": a 24h-window Math.ceil would mislabel "later today" as "1d". Math.round absorbs the
 * ±1h DST wobble between two midnights.
 */
export function trialEndInfo(trialEndsAt: string | null): TrialEndInfo {
  const end = trialEndsAt ? new Date(trialEndsAt) : null;
  const endLabel = end ? end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—';
  let daysLabel: string | null = null;
  let daysTone: TrialEndInfo['daysTone'] = 'muted';
  if (end) {
    if (end.getTime() <= Date.now()) {
      daysLabel = 'expirado';
      daysTone = 'danger';
    } else {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endDay = new Date(end);
      endDay.setHours(0, 0, 0, 0);
      const dayDiff = Math.round((endDay.getTime() - startOfToday.getTime()) / 86_400_000);
      daysLabel = dayDiff === 0 ? 'expira hoje' : `${dayDiff}d`;
      daysTone = dayDiff <= 3 ? 'warning' : 'muted';
    }
  }
  return { endLabel, daysLabel, daysTone };
}

/** "hoje", "ontem" or "há N dias" for a creation date. */
export function relativeCreated(iso: string, now: Date = new Date()): string {
  const days = Math.max(0, differenceInCalendarDays(now, new Date(iso)));
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}

export interface DashboardKpi {
  label: string;
  value: string | number;
  sub?: string;
  loading: boolean;
  tone?: 'warning';
  to?: string;
}

/** Everything the two layouts need; the page owns the queries and handlers. */
export interface DashboardViewProps {
  kpis: DashboardKpi[];
  risk: RiskCardProps;
  mrr: { loading: boolean; data: MrrSummary | undefined };
  trials: {
    loading: boolean;
    data: TrialsSummary | undefined;
    mrrCents: number | null;
    currency: string | undefined;
  };
  recent: { loading: boolean; workspaces: WorkspaceSummary[] };
  onExportPaying: () => void;
  onExportTrials: () => void;
}

/** The phone layout has no CSV export. */
export type DashboardPhoneProps = Omit<DashboardViewProps, 'onExportPaying' | 'onExportTrials'>;
