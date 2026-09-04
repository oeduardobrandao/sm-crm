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

  it('stays in preview and renders no error when onRecorded rejects (the parent owns the error)', async () => {
    vi.useFakeTimers();
    const onRecorded = vi.fn(async () => {
      throw new Error('Áudio maior que 15 MB. Grave um trecho mais curto.');
    });
    render(<AudioRecorder phase="idle" onRecorded={onRecorded} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /parar/i }));
    });

    vi.useRealTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));

    // Still in preview: Enviar is present, and no error text is rendered
    // (the recorder never sets its own `error` state on a rejection).
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
    expect(screen.queryByText(/áudio maior que 15 mb/i)).not.toBeInTheDocument();
    expect(document.querySelector('p.text-red-500')).not.toBeInTheDocument();
  });

  it('ignores a second click while a start is already in flight', async () => {
    let resolveGetUserMedia!: (v: { getTracks: () => { stop: () => void }[] }) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise((r) => {
          resolveGetUserMedia = r;
        }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    render(<AudioRecorder phase="idle" onRecorded={vi.fn(async () => {})} />);
    const btn = screen.getByRole('button', { name: /gravar áudio/i });

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGetUserMedia({ getTracks: () => [{ stop: stopTrack }] });
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('ignores a second Enviar click while a send is in flight, disables Descartar meanwhile, and returns to idle once it resolves', async () => {
    vi.useFakeTimers();
    let resolveOnRecorded!: () => void;
    const onRecorded = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOnRecorded = resolve;
        }),
    );
    render(<AudioRecorder phase="idle" onRecorded={onRecorded} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /parar/i }));
    });

    vi.useRealTimers();

    await act(async () => {
      const sendBtn = screen.getByRole('button', { name: /enviar/i });
      fireEvent.click(sendBtn);
      fireEvent.click(sendBtn);
    });

    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /descartar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /enviando/i })).toBeDisabled();

    await act(async () => {
      resolveOnRecorded();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /gravar áudio/i })).toBeInTheDocument(),
    );
  });

  it('does not leak an object URL when the recorder stops after unmount', async () => {
    vi.useFakeTimers();
    const onRecorded = vi.fn(async () => {});
    const { unmount } = render(<AudioRecorder phase="idle" onRecorded={onRecorded} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /gravar áudio/i }));
    });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    const rec = FakeMediaRecorder.instances[0];

    vi.useRealTimers();
    unmount();

    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
    rec.stop();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
