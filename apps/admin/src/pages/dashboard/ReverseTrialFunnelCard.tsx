import { Cell, GroupedList } from '@mesaas/ios-kit';
import type { ReverseTrialFunnel } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ErrorState';
import { GlassPanel } from '../../components/shell/GlassPanel';

export interface ReverseTrialFunnelCardProps {
  data: ReverseTrialFunnel | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
  phone?: boolean;
  className?: string;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** Share of the trials started, rounded; null when nothing started yet. */
  pct: number | null;
}

/** The five stages of the spec (Part 8), each as a share of the trials started. */
export function funnelStages(f: ReverseTrialFunnel): FunnelStage[] {
  const pct = (n: number) => (f.started > 0 ? Math.round((n / f.started) * 100) : null);
  return [
    { key: 'started', label: 'Começaram', count: f.started, pct: f.started > 0 ? 100 : null },
    {
      key: 'activated',
      label: 'Ativaram até o 7º dia',
      count: f.activated_d7,
      pct: pct(f.activated_d7),
    },
    { key: 'card', label: 'Adicionaram cartão', count: f.card_added, pct: pct(f.card_added) },
    { key: 'paid', label: 'Pagaram a 1ª cobrança', count: f.paid, pct: pct(f.paid) },
    { key: 'downgraded', label: 'Voltaram ao Free', count: f.downgraded, pct: pct(f.downgraded) },
  ];
}

export function funnelSubtitle(f: ReverseTrialFunnel): string {
  const running = `${f.running} em andamento`;
  const matured = `${f.matured_d7} com 7 dias ou mais`;
  return f.ended_by_admin > 0
    ? `${running} · ${matured} · ${f.ended_by_admin} encerrado${f.ended_by_admin === 1 ? '' : 's'} pelo admin`
    : `${running} · ${matured}`;
}

const TITLE = 'Teste sem cartão';
const ERROR_TEXT = 'Não foi possível carregar o funil do teste sem cartão.';
const EMPTY_TEXT = 'Nenhum teste sem cartão começou ainda.';

const valueOf = (s: FunnelStage) => (s.pct == null ? `${s.count}` : `${s.count} · ${s.pct}%`);

export function ReverseTrialFunnelCard({
  data,
  loading,
  error,
  retry,
  phone,
  className,
}: ReverseTrialFunnelCardProps) {
  const empty = !!data && data.started === 0;
  const stages = data ? funnelStages(data) : [];

  if (phone) {
    if (loading || error || empty || !data) {
      return (
        <section className="phone-kit phone-group" data-testid="reverse-trial-funnel">
          <h2 className="phone-group__header">{TITLE}</h2>
          <div className="phone-group__list">
            <div className="px-4 py-1">
              {loading ? (
                <Skeleton className="my-3 h-3 w-3/4" />
              ) : error ? (
                <ErrorState message={ERROR_TEXT} onRetry={retry} />
              ) : (
                <p className="py-3 text-[15px] text-muted-foreground">{EMPTY_TEXT}</p>
              )}
            </div>
          </div>
        </section>
      );
    }
    return (
      <div data-testid="reverse-trial-funnel">
        <GroupedList header={TITLE} footer={funnelSubtitle(data)} headerAs="h2">
          {stages.map((s) => (
            <Cell key={s.key} label={s.label} value={valueOf(s)} />
          ))}
        </GroupedList>
      </div>
    );
  }

  return (
    <div data-testid="reverse-trial-funnel" className={cn('min-w-0', className)}>
      <GlassPanel title={TITLE} flush>
        {loading ? (
          <div className="flex flex-col gap-3 px-[18px] pb-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3 w-3/4" />
            ))}
          </div>
        ) : error || !data ? (
          <div className="px-[18px] pb-4">
            <ErrorState message={ERROR_TEXT} onRetry={retry} />
          </div>
        ) : empty ? (
          <p className="px-[18px] pb-4 text-sm text-muted-foreground">{EMPTY_TEXT}</p>
        ) : (
          <>
            <p className="px-[18px] pb-3 text-xs text-muted-foreground">{funnelSubtitle(data)}</p>
            <ul className="flex flex-col gap-2.5 px-[18px] pb-4">
              {stages.map((s) => (
                <li key={s.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{s.label}</span>
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {valueOf(s)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-foreground/[0.08]" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${s.pct ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </GlassPanel>
    </div>
  );
}
