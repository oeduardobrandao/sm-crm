import { Navigate } from 'react-router-dom';
import { FileText, PlayCircle, Rocket, Search } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ListSkeleton } from '@/components/ui/skeletons';
import type { KbArticle } from '@/store/kb';
import { SECTION_ICONS } from '../components/SectionCard';
import {
  allCompleted,
  completedCount,
  formatDuration,
  pickInitial,
  resolveSelection,
  type VideoSearchHit,
} from '../videos/playlist';
import { useKbVideoSeries, useVideoProgress } from '../videos/useKbVideos';
import { readingMinutes } from './readingMinutes';
import './ajudaPhone.css';

export interface AjudaPhoneProps {
  search: string;
  onSearchChange: (value: string) => void;
  requestedVideoSlug: string | null;
  isLoading: boolean;
  isSearching: boolean;
  sections: { category: string; label: string; count: number }[];
  articles: KbArticle[];
  videos: VideoSearchHit[];
}

/** Section tile colours, iOS Settings style. */
const SECTION_COLORS = [
  '#ffbf30',
  '#007aff',
  '#34c759',
  '#af52de',
  '#30b0c7',
  '#ff2d55',
  '#ff9500',
  '#5856d6',
  '#8e8e93',
];

/**
 * The tutorial playlist as one row: the video the user would watch next (or the first,
 * once everything was watched). The player itself, with the series tabs, the list and
 * the progress, lives on /ajuda/video/:slug, which the row opens.
 */
function TutorialsGroup() {
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, isLoading: progressLoading } = useVideoProgress();
  if (isLoading || progressLoading || isError || series.length === 0) return null;

  const resolved = resolveSelection(series, pickInitial(series, progress, null));
  if (!resolved) return null;
  const { video, series: current } = resolved;
  const position = current.videos.findIndex((v) => v.id === video.id) + 1;
  const done = allCompleted(series, progress);
  const watched = completedCount(current, progress);

  return (
    <GroupedList
      header="Tutoriais em vídeo"
      footer={
        done
          ? 'Você já assistiu todos os vídeos.'
          : `${watched} de ${current.videos.length} assistidos nesta série.`
      }
    >
      <Cell
        to={`/ajuda/video/${video.slug}`}
        className="phone-ajuda-tutorial"
        aria-label={`Tutoriais em vídeo. ${current.title}, vídeo ${position} de ${current.videos.length}: ${video.title}`}
        icon={
          <span className="phone-ajuda-tutorial__thumb">
            {video.thumbnail_url ? (
              <img src={video.thumbnail_url} alt="" />
            ) : (
              <PlayCircle aria-hidden="true" />
            )}
            {video.duration_seconds != null && (
              <span className="phone-ajuda-tutorial__duration">
                {formatDuration(video.duration_seconds)}
              </span>
            )}
          </span>
        }
        label={
          <>
            <span className="phone-ajuda-tutorial__series">{current.title}</span>
            <span className="phone-ajuda-tutorial__title">{video.title}</span>
          </>
        }
        value={done ? 'Rever' : `${position} de ${current.videos.length}`}
      />
    </GroupedList>
  );
}

/** Central de Ajuda on phones (FAjuda): search, the tutorials row, sections as a list. */
export function AjudaPhone(props: AjudaPhoneProps) {
  // A video deep link (`?video=`, e.g. from a tutorial popup) opens the player screen.
  if (props.requestedVideoSlug) {
    return <Navigate to={`/ajuda/video/${encodeURIComponent(props.requestedVideoSlug)}`} replace />;
  }

  return (
    <div className="phone-kit phone-ajuda">
      <PhonePageHeader title="Central de Ajuda">
        <label className="phone-ajuda-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Buscar vídeos e artigos"
            placeholder="Buscar vídeos e artigos"
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
          />
        </label>
      </PhonePageHeader>

      {props.isLoading ? (
        <ListSkeleton rows={6} />
      ) : props.isSearching ? (
        props.articles.length === 0 && props.videos.length === 0 ? (
          <p className="phone-ajuda-empty" role="status">
            Nenhum vídeo ou artigo encontrado para esta busca.
          </p>
        ) : (
          <>
            {props.videos.length > 0 && (
              <GroupedList header="Vídeos">
                {props.videos.map(({ video, seriesTitle }) => (
                  <Cell
                    key={video.id}
                    to={`/ajuda/video/${video.slug}`}
                    icon={<PlayCircle />}
                    iconColor="#ff3b30"
                    label={video.title}
                    subtitle={`Vídeo · ${seriesTitle}`}
                    value={
                      video.duration_seconds != null
                        ? formatDuration(video.duration_seconds)
                        : undefined
                    }
                  />
                ))}
              </GroupedList>
            )}
            {props.articles.length > 0 && (
              <GroupedList header="Artigos">
                {props.articles.map((article) => (
                  <ArticleCell key={article.id} article={article} />
                ))}
              </GroupedList>
            )}
          </>
        )
      ) : (
        <>
          <TutorialsGroup />
          {props.sections.length === 0 ? (
            <p className="phone-ajuda-empty">Nenhum artigo publicado ainda.</p>
          ) : (
            <GroupedList header="Seções">
              {props.sections.map((s, i) => {
                const Icon = SECTION_ICONS[s.category] ?? Rocket;
                return (
                  <Cell
                    key={s.category}
                    to={`/ajuda/secao/${encodeURIComponent(s.category)}`}
                    icon={<Icon />}
                    iconColor={SECTION_COLORS[i % SECTION_COLORS.length]}
                    label={s.label}
                    subtitle={`${s.count} ${s.count === 1 ? 'artigo' : 'artigos'}`}
                  />
                );
              })}
            </GroupedList>
          )}
        </>
      )}
    </div>
  );
}

/** An article as a list row: title, reading time, draft tag. */
export function ArticleCell({ article }: { article: KbArticle }) {
  const minutes = readingMinutes(article.content_plain);
  return (
    <Cell
      to={`/ajuda/${article.slug}`}
      icon={<FileText />}
      label={article.title}
      subtitle={`${minutes} min de leitura${article.status === 'draft' ? ' · Rascunho' : ''}`}
    />
  );
}
