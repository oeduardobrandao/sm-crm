import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { AudioRecorder, isRecordingSupported, type RecorderPhase } from '@mesaas/ui/AudioRecorder';
import { describeAudioError } from '@mesaas/ui/audio/validation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CRM_AUDIO_VARS } from '@/lib/audioVars';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  deleteIdeiaAudio,
  fetchIdeiaAudio,
  retryIdeiaTranscription,
  uploadIdeiaAudio,
} from '@/services/ideiaAudio';
import type { Ideia } from '@/store';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  done: { label: 'Transcrito', variant: 'success' },
  pending: { label: 'Transcrição pendente', variant: 'warning' },
  failed: { label: 'Falha na transcrição', variant: 'danger' },
};

export function IdeiaAudioSection({
  ideia,
  canWrite,
  queryKey,
}: {
  ideia: Ideia;
  canWrite: boolean;
  queryKey: unknown[];
}) {
  const qc = useQueryClient();
  const { features } = useWorkspaceLimits();
  const audioAllowed = features?.feature_briefing_audio === true;
  const showRecorder = canWrite && audioAllowed && isRecordingSupported();
  const hasAudio = !!ideia.audio_r2_key;
  // DELETE is deliberately plan-ungated server-side (an agency that downgrades
  // off feature_briefing_audio must still be able to free the recording), so
  // removal can't be tied to showRecorder/audioAllowed like retry/re-record are.
  const canRemoveAudio = canWrite && hasAudio;

  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ['ideia-audio', ideia.id, ideia.audio_r2_key, ideia.audio_transcription_status],
    queryFn: () => fetchIdeiaAudio(ideia.id),
    staleTime: 30 * 60 * 1000,
    enabled: hasAudio,
  });

  if (!hasAudio && !showRecorder) return null;

  function refresh() {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['ideia-audio', ideia.id] });
  }

  async function handleRecorded(blob: Blob, mime: string, seconds: number) {
    try {
      await uploadIdeiaAudio({
        ideiaId: ideia.id,
        blob,
        mime,
        durationSeconds: seconds,
        onPhase: setPhase,
      });
      setRecording(false);
      refresh();
      toast.success('Áudio salvo.');
    } catch (e) {
      toast.error(describeAudioError(e, 'O envio do áudio falhou. Tente de novo.'));
      throw e;
    } finally {
      setPhase('idle');
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await retryIdeiaTranscription(ideia.id);
      refresh();
    } catch (e) {
      toast.error(describeAudioError(e, 'Não foi possível transcrever agora.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteIdeiaAudio(ideia.id);
      refresh();
      setConfirmRemove(false);
      toast.success('Áudio removido.');
    } catch (e) {
      toast.error(describeAudioError(e, 'Não foi possível remover o áudio.'));
    } finally {
      setBusy(false);
    }
  }

  const rawStatus =
    ideia.audio_transcription_status === 'pending'
      ? (data?.audio?.transcription_status ?? 'pending')
      : ideia.audio_transcription_status;
  const status = rawStatus ? STATUS[rawStatus] : null;
  const transcript = data?.transcript ?? ideia.audio_transcript;

  return (
    <div style={CRM_AUDIO_VARS}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">Áudio</p>
        {hasAudio && status && (
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        )}
      </div>
      {hasAudio && (
        <div className="space-y-2">
          {data?.audio ? (
            <AudioPlayer
              src={data.audio.url}
              durationSeconds={ideia.audio_duration_seconds}
              label="Áudio da ideia"
              className="w-full max-w-[380px] text-foreground"
            />
          ) : isError ? (
            <span className="text-xs text-muted-foreground">
              Não foi possível carregar o áudio.
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Carregando áudio…</span>
          )}
          {transcript && (
            <div className="rounded-lg bg-muted/60 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Transcrição
              </p>
              <p className="text-sm whitespace-pre-wrap">{transcript}</p>
            </div>
          )}
        </div>
      )}
      {(showRecorder ||
        canRemoveAudio ||
        (hasAudio && rawStatus === 'failed' && canWrite && audioAllowed)) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {hasAudio && rawStatus === 'failed' && canWrite && audioAllowed && (
            <Button type="button" variant="outline" size="sm" onClick={retry} disabled={busy}>
              {busy ? (
                <Loader2 size={13} className="animate-spin mr-1.5" />
              ) : (
                <RotateCcw size={13} className="mr-1.5" />
              )}
              Tentar novamente
            </Button>
          )}
          {showRecorder && hasAudio && !recording && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRecording(true)}
              disabled={busy}
            >
              <Mic size={13} className="mr-1.5" /> Gravar novamente
            </Button>
          )}
          {canRemoveAudio && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-[var(--danger-text)]"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              Remover áudio
            </Button>
          )}
        </div>
      )}
      {showRecorder && (!hasAudio || recording) && (
        <div className="mt-2">
          <AudioRecorder
            phase={phase}
            disabled={busy}
            onRecorded={handleRecorded}
            hint="Até 5:00."
          />
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o áudio?</AlertDialogTitle>
            <AlertDialogDescription>
              A gravação e a transcrição serão apagadas. Isso não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              disabled={busy}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
