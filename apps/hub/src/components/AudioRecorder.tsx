import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Mic } from 'lucide-react';
import { AudioPlayer } from '@mesaas/ui/AudioPlayer';
import { MAX_AUDIO_SECONDS, pickRecorderMime } from '../services/briefingAudio';

/** Hub tokens for the shared player (whitelabel-aware). */
export const HUB_AUDIO_VARS = {
  '--audio-btn-bg': 'var(--hub-primary)',
  '--audio-btn-fg': 'var(--hub-primary-fg)',
  '--audio-track': 'var(--hub-bd)',
  '--audio-fill': 'var(--hub-txt)',
} as CSSProperties;

export type RecorderPhase = 'idle' | 'uploading' | 'transcribing';

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const WARN_AT_SECONDS = 270;
const BTN =
  'inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold rounded-[var(--hub-r-ctl)] disabled:opacity-50';

interface Props {
  phase: RecorderPhase;
  disabled?: boolean;
  onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void>;
}

type Mode = 'idle' | 'recording' | 'preview';

export function AudioRecorder({ phase, disabled, onRecorded }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const discard = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setBlob(null);
    setElapsed(0);
    setMode('idle');
  }, [previewUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recorderRef.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
      }
      releaseStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  async function start() {
    if (mode !== 'idle' || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Permita o acesso ao microfone no navegador para gravar.'
            : 'Não foi possível acessar o microfone.',
        );
        return;
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        if (!mountedRef.current) return;
        const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const type = rec.mimeType || mime || 'audio/webm';
        const out = new Blob(chunksRef.current, { type });
        releaseStream();
        setElapsed(seconds);
        setBlob(out);
        setPreviewUrl(URL.createObjectURL(out));
        setMode('preview');
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      setMode('recording');
      rec.start(1000);
      tickRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_AUDIO_SECONDS) stop();
      }, 250);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function send() {
    if (!blob) return;
    const mime = blob.type || 'audio/webm';
    const seconds = elapsed;
    try {
      await onRecorded(blob, mime, seconds);
      discard();
    } catch {
      // The parent owns upload/transcription errors and renders them itself
      // (see BriefingPage's handleRecorded). Stay in preview so the user can
      // retry or discard; do not render a second error here.
    }
  }

  if (!isRecordingSupported()) return null;
  const busy = phase !== 'idle';

  return (
    <div className="space-y-2">
      {mode === 'idle' && (
        <button
          type="button"
          className={`${BTN} hub-btn-secondary`}
          disabled={disabled || busy || starting}
          onClick={() => void start()}
        >
          <Mic size={16} />
          {busy ? (phase === 'uploading' ? 'Enviando áudio…' : 'Transcrevendo…') : 'Gravar áudio'}
        </button>
      )}

      {mode === 'recording' && (
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
            aria-hidden
          />
          <span className="text-[13px] tabular-nums hub-txt">{formatDuration(elapsed)}</span>
          <button
            type="button"
            className={`${BTN} hub-btn-primary`}
            onClick={stop}
            aria-label="Parar gravação"
          >
            Parar
          </button>
          {elapsed >= WARN_AT_SECONDS && (
            <span className="text-xs hub-tx3">Limite de 5 minutos. A gravação para sozinha.</span>
          )}
        </div>
      )}

      {mode === 'preview' && previewUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <AudioPlayer
            src={previewUrl}
            durationSeconds={elapsed}
            label="Prévia"
            className="hub-txt w-full max-w-[360px]"
            style={HUB_AUDIO_VARS}
          />
          <button
            type="button"
            className={`${BTN} hub-btn-primary`}
            disabled={busy}
            onClick={() => void send()}
          >
            {phase === 'uploading'
              ? 'Enviando…'
              : phase === 'transcribing'
                ? 'Transcrevendo…'
                : 'Enviar'}
          </button>
          <button
            type="button"
            className={`${BTN} hub-btn-secondary`}
            disabled={busy}
            onClick={discard}
          >
            Descartar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
