import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';

// Shared across the CRM and Hub apps as '@mesaas/ui/AudioPlayer' (standalone
// file pattern from packages/ui/index.ts: no '@/' imports, never in the barrel).
//
// Minimal player the apps control: round play/pause, a seekable track and
// "current / total". Styled by CSS custom properties so each app maps its own
// tokens: --audio-btn-bg, --audio-btn-fg, --audio-track, --audio-fill.
//
// MediaRecorder .webm files report duration = Infinity, so `durationSeconds`
// (the recorder's timer, stored server-side) is the total when the media has none.

export interface AudioPlayerProps {
  src: string;
  durationSeconds?: number | null;
  className?: string;
  style?: CSSProperties;
  /** Accessible name prefix for the controls, e.g. "Resposta em áudio". */
  label?: string;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SEEK_STEP = 5;

export function AudioPlayer({ src, durationSeconds, className, style, label }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const total =
    mediaDuration && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : typeof durationSeconds === 'number' && durationSeconds > 0
        ? durationSeconds
        : 0;
  const ratio = total > 0 ? Math.min(1, current / total) : 0;

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setMediaDuration(null);
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play().catch(() => setPlaying(false));
  }

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el || total <= 0) return;
    const next = Math.max(0, Math.min(total, seconds));
    el.currentTime = next;
    setCurrent(next);
  }

  function onTrackClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekTo(((e.clientX - rect.left) / rect.width) * total);
  }

  function onTrackKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(current + SEEK_STEP);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(current - SEEK_STEP);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekTo(total);
    }
  }

  const name = label ? `${label}: ` : '';

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, ...style }}
    >
      <audio
        ref={audioRef}
        src={src}
        // 'none': a duração total vem de `durationSeconds` (o timer do
        // gravador), então não há motivo para baixar metadados de cada áudio
        // só para montar a lista. Os handlers de metadata continuam ligados
        // porque o browser os dispara assim que o play começa a carregar.
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        // Both wired: some engines (MediaRecorder .webm) only report a finite
        // duration on 'durationchange', not on 'loadedmetadata'.
        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `${name}Pausar` : `${name}Reproduzir`}
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 9999,
          border: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--audio-btn-bg, currentColor)',
        }}
      >
        {playing ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="var(--audio-btn-fg, #fff)"
            aria-hidden
          >
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="var(--audio-btn-fg, #fff)"
            aria-hidden
          >
            <path d="M8 5.5v13l10-6.5z" />
          </svg>
        )}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${name}Posição`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatClock(current)} de ${formatClock(total)}`}
        onClick={onTrackClick}
        onKeyDown={onTrackKey}
        style={{
          flex: '1 1 0',
          minWidth: 80,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 4,
            borderRadius: 9999,
            background: 'var(--audio-track, rgba(0,0,0,.1))',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${ratio * 100}%`,
              borderRadius: 9999,
              background: 'var(--audio-fill, currentColor)',
            }}
          />
        </div>
      </div>
      <span
        style={{ flexShrink: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}
      >
        {formatClock(current)} / {formatClock(total)}
      </span>
    </div>
  );
}
