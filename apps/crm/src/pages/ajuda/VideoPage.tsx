import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import type { KbVideo } from '@/store/kbVideos';
import { VideoPlaylistBlock } from './videos/VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './videos/useKbVideos';
import { recordKbViewSafely } from './useRecordKbView';

export default function VideoPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();

  const video = useMemo(
    () => series.flatMap((s) => s.videos).find((v) => v.slug === slug) ?? null,
    [series, slug],
  );

  // Same capture+restore as EntregasPage: nothing else sets the tab title for this route.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${video ? video.title : 'Vídeo'} | Mesaas`;
    return () => {
      document.title = previousTitle;
    };
  }, [video]);

  // Keep the URL shareable as the user moves through the playlist.
  const handleVideoChange = (current: KbVideo) => {
    if (current.slug !== slug) navigate(`/ajuda/video/${current.slug}`, { replace: true });
  };

  if (isLoading || progressLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !video) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-[var(--text-light)]">Vídeo não encontrado.</p>
        <Link to="/ajuda">
          <Button variant="outline" size="sm">
            Voltar à Central de Ajuda
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/ajuda"
        className="inline-flex items-center gap-1.5 text-[0.82rem] text-[var(--text-light)] transition-colors hover:text-[var(--text-main)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Central de Ajuda
      </Link>
      <VideoPlaylistBlock
        series={series}
        progress={progress}
        onSaveProgress={save}
        requestedSlug={slug ?? null}
        onVideoChange={handleVideoChange}
        onFirstPlay={(videoId) => recordKbViewSafely({ videoId })}
      />
    </div>
  );
}
