import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { Button } from '@/components/ui/button';
import type { KbVideo } from '@/store/kbVideos';
import { VideoPlaylistBlock } from './videos/VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './videos/useKbVideos';
import { recordKbViewSafely } from './useRecordKbView';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import './phone/ajudaPhone.css';

function BackToAjuda() {
  const isPhone = !useIsDesktop(768);
  if (isPhone) {
    return (
      <PhoneNavBar
        className="phone-ajuda-video-nav"
        title="Tutoriais em vídeo"
        titleAs="span"
        backLabel="Voltar para Central de Ajuda"
        fallbackTo="/ajuda"
      />
    );
  }
  return (
    <Link
      to="/ajuda"
      className="inline-flex items-center gap-1.5 text-[0.82rem] text-[var(--text-light)] transition-colors hover:text-[var(--text-main)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Central de Ajuda
    </Link>
  );
}

export default function VideoPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const isPhone = !useIsDesktop(768);
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
      <div className="space-y-6">
        <BackToAjuda />
        <SkeletonStatus>
          {/* Mirrors VideoPlaylistBlock: the 16:9 stage with its title, beside the playlist rail. */}
          <div className="grid gap-5 min-[901px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <Skeleton className="aspect-video w-full rounded-2xl" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-2/3" />
            </div>
            <div className="flex min-w-0 flex-col gap-3 self-start rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
                  <Skeleton
                    className="h-3.5 flex-1"
                    style={{ maxWidth: `${80 - (i % 3) * 12}%` }}
                  />
                  <Skeleton className="h-3 w-8 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </SkeletonStatus>
      </div>
    );
  }

  if (isError || !video) {
    return (
      <>
        {isPhone && <BackToAjuda />}
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <p className="text-[var(--text-light)]">Vídeo não encontrado.</p>
          <Link to="/ajuda">
            <Button variant="outline" size="sm">
              Voltar à Central de Ajuda
            </Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <BackToAjuda />
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
