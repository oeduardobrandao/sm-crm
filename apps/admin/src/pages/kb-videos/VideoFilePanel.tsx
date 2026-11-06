import { Loader2, Upload, X } from 'lucide-react';
import { formatDuration } from '../../lib/kb-video-status';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { KbVideoEditorViewProps } from './editor-view';

type Props = Pick<
  KbVideoEditorViewProps,
  'video' | 'badge' | 'progress' | 'fileInputRef' | 'onFile' | 'onCancelUpload' | 'fetching'
> & { phone?: boolean };

/** The "Arquivo" block: thumbnail, processing badge, upload progress and the file picker. */
export function VideoFilePanel({
  video,
  badge,
  progress,
  fileInputRef,
  onFile,
  onCancelUpload,
  fetching,
  phone,
}: Props) {
  if (!video) {
    return <p className="text-sm text-muted-foreground">Salve o vídeo para enviar o arquivo.</p>;
  }
  const uploading = progress !== null;
  const percent = Math.round((progress ?? 0) * 100);
  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-secondary text-muted-foreground"
      >
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Upload size={phone ? 40 : 32} strokeWidth={1.6} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {badge && (
          <Badge variant={badge.variant} size="md">
            {uploading ? `Enviando ${percent}%` : badge.label}
          </Badge>
        )}
        {video.duration_seconds != null && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>
      {uploading && (
        <div
          role="progressbar"
          aria-label="Envio do vídeo"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      )}
      <input
        ref={fileInputRef}
        id="video-file"
        aria-label="Arquivo de vídeo"
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      {uploading ? (
        <Button
          type="button"
          variant={phone ? 'destructive' : 'outline'}
          className={cn(phone && 'h-11 w-full rounded-xl text-[17px] font-normal')}
          onClick={onCancelUpload}
        >
          <X /> Cancelar envio
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className={cn(phone && 'h-11 w-full rounded-xl text-[17px] font-normal')}
          onClick={() => fileInputRef.current?.click()}
        >
          {fetching ? <Loader2 className="animate-spin" /> : <Upload />}
          {video.stream_uid ? 'Substituir arquivo' : 'Enviar arquivo'}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        MP4 ou MOV, até 200 MB e 15 minutos.
        {phone && ' Mantenha o app aberto até terminar.'}
      </p>
    </div>
  );
}
