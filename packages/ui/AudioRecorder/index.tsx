import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Mic } from 'lucide-react';
import { AudioPlayer } from '../AudioPlayer';
import { MAX_AUDIO_SECONDS, pickRecorderMime } from '../audio/validation';

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
const BTN_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 'var(--audio-radius, 10px)',
  border: '1px solid transparent',
  cursor: 'pointer',
};
const BTN_PRIMARY: CSSProperties = {
  ...BTN_BASE,
  background: 'var(--audio-btn-bg, currentColor)',
  color: 'var(--audio-btn-fg, #fff)',
};
const BTN_SECONDARY: CSSProperties = {
  ...BTN_BASE,
  background: 'var(--audio-btn2-bg, transparent)',
  color: 'var(--audio-btn2-fg, currentColor)',
  borderColor: 'var(--audio-btn2-bd, rgba(0,0,0,.2))',
};
const MUTED: CSSProperties = { color: 'var(--audio-muted, currentColor)', opacity: 0.8 };

interface Props {
  phase: RecorderPhase;
  disabled?: boolean;
  onRecorded: (blob: Blob, mime: string, durationSeconds: number) => Promise<void>;
  /** Label of the confirm button in the preview state. Default "Enviar". */
  sendLabel?: string;
  /** Helper text next to the record button. Default "Até 5:00 por resposta.". */
  hint?: string;
}

type Mode = 'idle' | 'recording' | 'preview';

export function AudioRecorder({ phase, disabled, onRecorded, sendLabel = 'Enviar', hint }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);
  const sendingRef = useRef(false);
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
    if (!blob || sendingRef.current || disabled) return;
    sendingRef.current = true;
    setSending(true);
    const mime = blob.type || 'audio/webm';
    const seconds = elapsed;
    try {
      await onRecorded(blob, mime, seconds);
      discard();
    } catch {
      // The parent owns upload/transcription errors and renders them itself
      // (see BriefingPage's handleRecorded). Stay in preview so the user can
      // retry or discard; do not render a second error here.
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (!isRecordingSupported()) return null;
  const busy = phase !== 'idle';
  const nearLimit = elapsed >= WARN_AT_SECONDS;

  return (
    <div className="space-y-2">
      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            style={BTN_SECONDARY}
            className="disabled:opacity-50"
            disabled={disabled || busy || starting}
            onClick={() => void start()}
          >
            <Mic size={16} />
            {busy ? (phase === 'uploading' ? 'Enviando áudio…' : 'Transcrevendo…') : 'Gravar áudio'}
          </button>
          {!busy && (
            <span className="text-xs" style={MUTED}>
              {hint ?? `Até ${formatDuration(MAX_AUDIO_SECONDS)} por resposta.`}
            </span>
          )}
        </div>
      )}

      {mode === 'recording' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
              aria-hidden
            />
            <span className="text-[13px] tabular-nums">
              {formatDuration(elapsed)} / {formatDuration(MAX_AUDIO_SECONDS)}
            </span>
            <button
              type="button"
              style={BTN_PRIMARY}
              className="disabled:opacity-50"
              onClick={stop}
              aria-label="Parar gravação"
            >
              Parar
            </button>
            {nearLimit && (
              <span className="text-xs text-amber-600">
                Restam {formatDuration(MAX_AUDIO_SECONDS - elapsed)}. A gravação para sozinha no
                limite.
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label="Tempo de gravação"
            aria-valuemin={0}
            aria-valuemax={MAX_AUDIO_SECONDS}
            aria-valuenow={elapsed}
            className="h-1 w-full max-w-[420px] overflow-hidden rounded-full"
            style={{ background: 'var(--audio-track, rgba(0,0,0,.1))' }}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${
                nearLimit ? 'bg-amber-500' : ''
              }`}
              style={{
                width: `${Math.min(100, (elapsed / MAX_AUDIO_SECONDS) * 100)}%`,
                background: nearLimit ? undefined : 'var(--audio-fill, currentColor)',
              }}
            />
          </div>
        </div>
      )}

      {mode === 'preview' && previewUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <AudioPlayer
            src={previewUrl}
            durationSeconds={elapsed}
            label="Prévia"
            className="w-full max-w-[360px]"
          />
          <button
            type="button"
            style={BTN_PRIMARY}
            className="disabled:opacity-50"
            disabled={disabled || busy || sending}
            onClick={() => void send()}
          >
            {sending || phase === 'uploading'
              ? 'Enviando…'
              : phase === 'transcribing'
                ? 'Transcrevendo…'
                : sendLabel}
          </button>
          <button
            type="button"
            style={BTN_SECONDARY}
            className="disabled:opacity-50"
            disabled={disabled || busy || sending}
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
