import { useQuery } from '@tanstack/react-query';
import { getBlogPostMetrics } from '../../lib/api';
import { Skeleton } from '../../components/ui/skeleton';
import { DailyChart } from './DailyChart';
import { formatInt, formatDateTime, type PostMetrics } from './blog-view';

const CHART_DAYS = 90;

export interface BlogPerformanceProps {
  slug: string;
  /** Undefined = a live post nobody has viewed yet: zeros. */
  metrics: PostMetrics | undefined;
  /** Null = Search Console never synced (not configured). */
  gscUpdatedAt: string | null;
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-sf text-xl font-bold tabular-nums leading-tight">{formatInt(value)}</p>
    </div>
  );
}

/** "Desempenho" of a live post: view tiles plus the daily views chart. The Search Console
 * tiles, charts and index card arrive with the collector; until it has synced, one line says
 * so. */
export function BlogPerformance({ slug, metrics, gscUpdatedAt }: BlogPerformanceProps) {
  const series = useQuery({
    queryKey: ['admin', 'blog', 'post-metrics', slug],
    queryFn: () => getBlogPostMetrics(slug, CHART_DAYS),
    staleTime: 5 * 60_000,
  });

  return (
    <section aria-labelledby={`perf-${slug}`} className="border-b border-border px-[18px] py-4">
      <h3 id={`perf-${slug}`} className="mb-3 font-sf text-[15px] font-semibold">
        Desempenho
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
        <Tile label="Views 7 dias" value={metrics?.views_7d ?? 0} />
        <Tile label="Views 30 dias" value={metrics?.views_30d ?? 0} />
        <Tile label="Views total" value={metrics?.views_total ?? 0} />
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Views por dia</p>
        <div className="h-44">
          {series.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : series.isError || !series.data ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar o gráfico.</p>
          ) : (
            <DailyChart
              days={series.data.views.map((v) => v.day)}
              datasets={[{ label: 'Views', data: series.data.views.map((v) => v.views) }]}
              ariaLabel={`Views por dia, últimos ${CHART_DAYS} dias`}
            />
          )}
        </div>
      </div>

      {gscUpdatedAt === null ? (
        <p className="mt-4 text-sm text-muted-foreground">Search Console não configurado.</p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Search Console atualizado em {formatDateTime(gscUpdatedAt)}. Os dados do Google chegam com
          2 a 3 dias de atraso.
        </p>
      )}
    </section>
  );
}
