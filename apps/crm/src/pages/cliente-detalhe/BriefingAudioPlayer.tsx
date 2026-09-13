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
    queryKey: [
      'briefing-audio-url',
      question.id,
      question.audio_r2_key,
      question.audio_transcription_status,
    ],
    queryFn: () => fetchBriefingAudio(question.id),
    // A URL assinada vale 60 min; 30 dá folga de sobra para refetch. Incluir
    // audio_transcription_status na key força um refetch quando a pergunta-pai
    // (que refaz o fetch ao focar a aba) enxerga um status mais novo — do
    // contrário essa query fica presa no valor cacheado por até 30 min.
    staleTime: 30 * 60 * 1000,
    enabled: !!question.audio_r2_key,
  });
  if (!question.audio_r2_key) return null;
  // question.audio_transcription_status é o valor mais fresco (a pergunta-pai
  // refaz o fetch ao focar). Só quando ele ainda está 'pending' é que vale a
  // pena preferir o status da view já buscada, que aplica a regra de "pending
  // velho vira failed" (STALE_PENDING_MS, _shared/briefing-audio.ts) — nos
  // demais casos (done/failed) o status da pergunta já é definitivo.
  const rawStatus =
    question.audio_transcription_status === 'pending'
      ? (data?.transcription_status ?? 'pending')
      : question.audio_transcription_status;
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
