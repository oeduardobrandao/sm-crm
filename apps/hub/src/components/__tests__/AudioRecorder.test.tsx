import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ durationSeconds }: { durationSeconds?: number | null }) => (
    <div data-testid="audio-player">{`player ${durationSeconds ?? 0}s`}</div>
  ),
}));

import { AudioRecorder, formatDuration, isRecordingSupported } from '../AudioRecorder';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (m: string) => m === 'audio/webm;codecs=opus';
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AudioRecorder', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
  });

  it('is unsupported in insecure contexts', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(isRecordingSupported()).toBe(false);
  });

  it('records, previews and hands the blob with elapsed seconds to onRecorded', async () => {
    vi.useFakeTimers();
    const onRecorded = vi.fn(async () => {});
    render(<AudioRecorder phase="idle" onRecorded={onRecorded} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus');

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('0:03')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /parar/i }));
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByTestId('audio-player')).toHaveTextContent('player 3s');
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();

    // Recording/timer flow is done; switch back to real timers before
    // `waitFor` below -- @testing-library/react's asyncWrapper drains the
    // microtask queue with a real `setTimeout(...,0)` under the hood, which
    // it never detects as vitest fake timers (it only checks for a global
    // `jest`), so it hangs forever if fake timers are still active.
    vi.useRealTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const [blob, mime, seconds] = onRecorded.mock.calls[0] as unknown as [Blob, string, number];
    expect(blob.size).toBe(3);
    expect(mime).toBe('audio/webm;codecs=opus');
    expect(seconds).toBe(3);
  });

  it('shows a message when the microphone permission is denied', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    render(<AudioRecorder phase="idle" onRecorded={vi.fn(async () => {})} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    expect(screen.getByText(/permita o acesso ao microfone/i)).toBeInTheDocument();
  });
});
