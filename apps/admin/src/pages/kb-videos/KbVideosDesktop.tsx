import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Upload } from 'lucide-react';
import { groupCheckState } from '../../lib/kb-bulk';
import { formatDuration, processingBadge, publishBadge } from '../../lib/kb-video-status';
import { kbVideoEditPath, kbVideoNewPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/PageHeader';
import { RowLink } from '../../components/RowLink';
import { KbViewStats } from '../../components/KbViewStats';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { newVideoInSeriesPath, type KbVideosViewProps } from './list-view';

/** Desktop list: a section per series with a grid of 16:9 video cards (DkVideos). */
export function KbVideosDesktop(p: KbVideosViewProps) {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Vídeos"
        description="Playlist da Central de Ajuda do CRM"
        actions={
          <>
            <Button variant="secondary" aria-pressed={p.selectMode} onClick={p.onToggleSelectMode}>
              {p.selectMode ? 'Concluir' : 'Selecionar'}
            </Button>
            <Button onClick={p.onNewSeries}>
              <Plus />
              Nova série
            </Button>
          </>
        }
      />

      {p.statusBody ?? (
        <div className="flex flex-col gap-6">
          {p.groups.map(({ series, videos }) => {
            const sBadge = publishBadge(series.status);
            const groupIds = videos.map((v) => v.id);
            const headingId = `kb-series-${series.id}`;
            return (
              <section key={series.id} aria-labelledby={headingId}>
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {p.selectMode && videos.length > 0 && (
                      <Checkbox
                        className="mr-1"
                        aria-label={`Selecionar todos os vídeos de ${series.title}`}
                        checked={groupCheckState(p.selected, groupIds)}
                        onCheckedChange={() => p.onToggleGroup(groupIds)}
                      />
                    )}
                    <h2 id={headingId} className="truncate text-[17px] font-semibold">
                      {series.title}
                    </h2>
                    <Badge variant={sBadge.variant}>{sBadge.label}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => p.onEditSeries(series)}>
                      Editar série
                    </Button>
                    <Button variant="secondary" asChild>
                      <Link to={newVideoInSeriesPath(kbVideoNewPath(), series.id)}>
                        <Upload />
                        Enviar vídeo
                      </Link>
                    </Button>
                  </div>
                </div>

                {videos.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">Nenhum vídeo nesta série.</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
                    {videos.map((v, index) => {
                      const pBadge = publishBadge(v.status);
                      const sb = processingBadge(v);
                      const to = kbVideoEditPath(v.id);
                      const duration = formatDuration(v.duration_seconds);
                      const picked = p.selected.has(v.id);
                      return (
                        <article
                          key={v.id}
                          onClick={() => (p.selectMode ? p.onToggleOne(v.id) : navigate(to))}
                          className={cn(
                            'admin-glass relative cursor-pointer overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:bg-secondary/40',
                            picked && 'ring-2 ring-primary',
                          )}
                        >
                          <div className="relative aspect-video bg-secondary">
                            {v.thumbnail_url && (
                              <img
                                src={v.thumbnail_url}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            )}
                            {duration && (
                              <span className="absolute bottom-2 right-2 rounded-md bg-black/[0.65] px-1.5 text-xs font-semibold tabular-nums text-white">
                                {duration}
                              </span>
                            )}
                            {p.selectMode && (
                              <div
                                className="absolute left-2 top-2 flex rounded-md bg-background/80 p-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  aria-label={`Selecionar ${v.title}`}
                                  checked={picked}
                                  onCheckedChange={() => p.onToggleOne(v.id)}
                                />
                              </div>
                            )}
                          </div>
                          <div className="px-3.5 py-3">
                            {p.selectMode ? (
                              <span className="block truncate text-[15px] font-semibold">
                                {v.title}
                              </span>
                            ) : (
                              <RowLink to={to} className="block truncate text-[15px] font-semibold">
                                {v.title}
                              </RowLink>
                            )}
                            <div className="my-1.5 flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant={pBadge.variant}>{pBadge.label}</Badge>
                                <Badge variant={sb.variant}>{sb.label}</Badge>
                              </div>
                              <div
                                className="flex shrink-0 gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Mover ${v.title} para cima`}
                                  disabled={index === 0 || p.reorderPending}
                                  onClick={() => p.onMove(videos, index, -1)}
                                >
                                  <ArrowLeft />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Mover ${v.title} para baixo`}
                                  disabled={index === videos.length - 1 || p.reorderPending}
                                  onClick={() => p.onMove(videos, index, 1)}
                                >
                                  <ArrowRight />
                                </Button>
                              </div>
                            </div>
                            <KbViewStats
                              stats={p.statsFor(v.id)}
                              loading={p.statsLoading}
                              failed={p.statsFailed}
                              showCompleted
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
