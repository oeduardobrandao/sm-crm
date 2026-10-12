import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, Film, FolderPlus, Plus, Video } from 'lucide-react';
import { ActionSheet, Cell, GroupedList, PhoneIconButton, SwipeRow } from '@mesaas/ios-kit';
import type { SwipeAction } from '@mesaas/ios-kit';
import type { KbVideo } from '../../lib/api';
import { groupCheckState } from '../../lib/kb-bulk';
import { formatDuration, processingBadge, publishBadge } from '../../lib/kb-video-status';
import { kbVideoEditPath, kbVideoNewPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/PageHeader';
import { KbViewStats } from '../../components/KbViewStats';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import type { KbVideosViewProps } from './list-view';

function Thumb({ video }: { video: KbVideo }) {
  const duration = formatDuration(video.duration_seconds);
  return (
    <span
      aria-hidden="true"
      className="relative flex h-[45px] w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-muted-foreground"
    >
      {video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Film size={18} />
      )}
      {duration && (
        <span className="absolute bottom-[3px] right-1 rounded bg-black/70 px-1 text-[10px] font-semibold tabular-nums text-white">
          {duration}
        </span>
      )}
    </span>
  );
}

/** Phone list: large title, one grouped list of video rows per series (Videos board). */
export function KbVideosPhone(p: KbVideosViewProps) {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Vídeos"
        description="Playlist da Central de Ajuda do CRM"
        phoneActions={
          <>
            <button
              type="button"
              aria-label={p.selectMode ? 'Concluir seleção' : 'Selecionar vídeos'}
              aria-pressed={p.selectMode}
              onClick={p.onToggleSelectMode}
              className="h-9 rounded-full bg-foreground/[0.12] px-3.5 text-[15px] font-semibold text-foreground"
            >
              {p.selectMode ? 'Concluir' : 'Selecionar'}
            </button>
            <PhoneIconButton
              label="Novo vídeo ou nova série"
              variant="ink"
              onClick={() => setAddOpen(true)}
            >
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </>
        }
      />

      {p.statusBody ??
        p.groups.map(({ series, videos }) => {
          const sBadge = publishBadge(series.status);
          const groupIds = videos.map((v) => v.id);
          const headingId = `kb-series-${series.id}`;
          return (
            <section key={series.id} aria-labelledby={headingId}>
              <div className="mx-4 mb-1.5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {p.selectMode && videos.length > 0 && (
                    <Checkbox
                      aria-label={`Selecionar todos os vídeos de ${series.title}`}
                      checked={groupCheckState(p.selected, groupIds)}
                      onCheckedChange={() => p.onToggleGroup(groupIds)}
                    />
                  )}
                  <h2
                    id={headingId}
                    className="truncate text-[13px] font-semibold uppercase tracking-[0.02em] text-muted-foreground"
                  >
                    {series.title}
                    {' · '}
                    <span className={cn(series.status === 'published' && 'text-success')}>
                      {sBadge.label}
                    </span>
                  </h2>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-[13px] font-semibold text-primary"
                  onClick={() => p.onEditSeries(series)}
                >
                  Editar série
                </button>
              </div>
              <GroupedList aria-label={`Vídeos de ${series.title}`}>
                {videos.length === 0 ? (
                  <Cell label="Nenhum vídeo nesta série." />
                ) : (
                  videos.map((v, index) => {
                    const pBadge = publishBadge(v.status);
                    const sb = processingBadge(v);
                    const duration = formatDuration(v.duration_seconds);
                    const stats = (
                      <span className="mt-0.5 block">
                        <KbViewStats
                          stats={p.statsFor(v.id)}
                          loading={p.statsLoading}
                          failed={p.statsFailed}
                          showCompleted
                        />
                      </span>
                    );
                    const body = (
                      <>
                        <Thumb video={v} />
                        <span className="phone-cell__body">
                          <span className="phone-cell__text">
                            <span className="phone-cell__label">{v.title}</span>
                            {duration && <span className="sr-only">{`Duração ${duration}`}</span>}
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              <Badge variant={pBadge.variant}>{pBadge.label}</Badge>
                              <Badge variant={sb.variant}>{sb.label}</Badge>
                            </span>
                            {stats}
                          </span>
                          {!p.selectMode && (
                            <ChevronRight className="phone-cell__chevron" aria-hidden="true" />
                          )}
                        </span>
                      </>
                    );

                    if (p.selectMode) {
                      return (
                        <li key={v.id} className="phone-cell">
                          <div
                            className="phone-cell__main"
                            role="presentation"
                            onClick={() => p.onToggleOne(v.id)}
                          >
                            <span className="flex" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                className="h-5 w-5 rounded-full"
                                aria-label={`Selecionar ${v.title}`}
                                checked={p.selected.has(v.id)}
                                onCheckedChange={() => p.onToggleOne(v.id)}
                              />
                            </span>
                            {body}
                          </div>
                        </li>
                      );
                    }

                    const actions: SwipeAction[] = [];
                    if (index > 0) {
                      actions.push({
                        label: 'Subir',
                        icon: <ArrowUp />,
                        onAction: () => p.onMove(videos, index, -1),
                      });
                    }
                    if (index < videos.length - 1) {
                      actions.push({
                        label: 'Descer',
                        icon: <ArrowDown />,
                        onAction: () => p.onMove(videos, index, 1),
                      });
                    }
                    return (
                      <SwipeRow key={v.id} as="li" className="phone-cell" trailingActions={actions}>
                        <Link to={kbVideoEditPath(v.id)} className="phone-cell__main">
                          {body}
                        </Link>
                      </SwipeRow>
                    );
                  })
                )}
              </GroupedList>
            </section>
          );
        })}

      <ActionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Adicionar"
        actions={[
          {
            label: 'Novo vídeo',
            icon: <Video />,
            onSelect: () => navigate(kbVideoNewPath()),
          },
          {
            label: 'Nova série',
            icon: <FolderPlus />,
            onSelect: p.onNewSeries,
          },
        ]}
      />
    </>
  );
}
