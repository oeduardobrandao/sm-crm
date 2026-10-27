import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { getBlogPostMetrics } from '../../lib/api';
import { Skeleton } from '../../components/ui/skeleton';
import { DailyChart } from './DailyChart';
import { Badge } from '../../components/ui/badge';
import {
  formatDateTimeFull,
  formatDay,
  formatInt,
  formatPercent,
  formatPosition,
  indexStatusView,
  type PostMetrics,
} from './blog-view';

const CHART_DAYS = 90;

export interface BlogPerformanceProps {
  slug: string;
  /** Undefined = a live post nobody has viewed yet: zeros. */
  metrics: PostMetrics | undefined;
  /** Null = Search Console never synced (not configured). */
  gscUpdatedAt: string | null;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-sf text-xl font-bold tabular-nums leading-tight">{value}</p>
    </div>
  );
}

const TILE_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2';

/** "Desempenho" of a live post: view tiles and chart, then (once Search Console has synced)
 * its tiles, its own chart and the index card. Views use São Paulo days and Search Console
 * Google's own, so they never share a chart. */
export function BlogPerformance({ slug, metrics, gscUpdatedAt }: BlogPerformanceProps) {
  const search = metrics?.search ?? null;
  const index = metrics?.index ?? null;
  const indexView = indexStatusView(index);
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
      <div className={TILE_GRID}>
        <Tile label="Views 7 dias" value={formatInt(metrics?.views_7d ?? 0)} />
        <Tile label="Views 30 dias" value={formatInt(metrics?.views_30d ?? 0)} />
        <Tile label="Views total" value={formatInt(metrics?.views_total ?? 0)} />
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
        <>
          <div className={`${TILE_GRID} mt-4`}>
            <Tile label="Cliques 28 dias" value={formatInt(search?.clicks ?? 0)} />
            <Tile label="Impressões 28 dias" value={formatInt(search?.impressions ?? 0)} />
            <Tile label="CTR" value={formatPercent(search?.ctr ?? 0)} />
            <Tile
              label="Posição média"
              value={search?.position != null ? formatPosition(search.position) : '-'}
            />
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Cliques e impressões por dia (datas do Google)
            </p>
            <div className="h-44">
              {series.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : series.isError || !series.data ? (
                <p className="text-sm text-muted-foreground">
                  Não foi possível carregar o gráfico.
                </p>
              ) : series.data.search.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados do Google ainda.</p>
              ) : (
                <DailyChart
                  days={series.data.search.map((v) => v.day)}
                  datasets={[
                    { label: 'Cliques', data: series.data.search.map((v) => v.clicks) },
                    { label: 'Impressões', data: series.data.search.map((v) => v.impressions) },
                  ]}
                  ariaLabel={`Cliques e impressões por dia, últimos ${CHART_DAYS} dias`}
                />
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-muted-foreground">Indexação</span>
              <Badge variant={indexView.tone} size="sm">
                {indexView.label}
              </Badge>
              {index?.last_crawl_time && (
                <span className="text-xs text-muted-foreground">
                  Último rastreio: {formatDay(index.last_crawl_time)}
                </span>
              )}
            </div>
            {index?.inspection_link ? (
              <>
                <a
                  href={index.inspection_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Ver no Search Console
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  Para pedir indexação, clique em Solicitar indexação na página do Google.
                </p>
              </>
            ) : index === null || index.verdict === null ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Ainda não verificado pelo Google
              </p>
            ) : null}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Search Console atualizado em {formatDateTimeFull(gscUpdatedAt)}. Os dados do Google
            chegam com 2 a 3 dias de atraso.
          </p>
        </>
      )}
    </section>
  );
}
