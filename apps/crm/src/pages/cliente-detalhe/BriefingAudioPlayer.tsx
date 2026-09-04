import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { Badge } from '@/components/ui/badge';
import { fetchBriefingAudio } from '@/services/briefingAudio';
import type { HubBriefingQuestionRow } from '@/store/hub';

/** CRM tokens for the shared player: ink CTA button, subtle track. */
const CRM_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--cta-bg)',
  '--audio-btn-fg': 'var(--cta-fg)',
  '--audio-track': 'var(--surface-2)',
  '--audio-fill': 'var(--text-main)',
} as CSSProperties;

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  done: { label: 'Transcrito', variant: 'success' },
  pending: { label: 'Transcrição pendente', variant: 'warning' },
  failed: { label: 'Falha na transcrição', variant: 'danger' },
};

export function BriefingAudioPlayer({ question }: { question: HubBriefingQuestionRow }) {
  const { data, isError } = useQuery({
    queryKey: ['briefing-audio-url', question.id, question.audio_r2_key],
    queryFn: () => fetchBriefingAudio(question.id),
    // A URL assinada vale 60 min; 30 dá folga de sobra para refetch.
    staleTime: 30 * 60 * 1000,
    enabled: !!question.audio_r2_key,
  });
  if (!question.audio_r2_key) return null;
  // A view já buscada aplica a regra de "pending velho vira failed"
  // (STALE_PENDING_MS, _shared/briefing-audio.ts); a coluna crua da pergunta é
  // só o fallback enquanto a URL assinada não chegou.
  const rawStatus = data?.transcription_status ?? question.audio_transcription_status;
  const status = rawStatus ? STATUS[rawStatus] : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {data ? (
        <AudioPlayer
          src={data.url}
          durationSeconds={question.audio_duration_seconds}
          label="Resposta em áudio"
          className="w-full max-w-[380px] text-foreground"
          style={CRM_AUDIO_VARS}
        />
      ) : isError ? (
        <span className="text-xs text-muted-foreground">Não foi possível carregar o áudio.</span>
      ) : (
        <span className="text-xs text-muted-foreground">Carregando áudio…</span>
      )}
      {status && (
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
      )}
    </div>
  );
}
