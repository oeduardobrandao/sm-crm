import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchBriefing: vi.fn(),
  submitBriefingAnswer: vi.fn(),
  presignBriefingAudio: vi.fn(),
  finalizeBriefingAudio: vi.fn(),
  retryBriefingTranscription: vi.fn(),
  deleteBriefingAudio: vi.fn(),
}));
vi.mock('../../services/briefingAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/briefingAudio')>()),
  uploadBriefingAudio: vi.fn(),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ durationSeconds }: { durationSeconds?: number | null }) => (
    <div data-testid="audio-player">{`player ${durationSeconds ?? 0}s`}</div>
  ),
}));
vi.mock('../../components/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  HUB_AUDIO_VARS: {},
  AudioRecorder: ({
    onRecorded,
    phase,
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    phase: string;
  }) => (
    <button
      type="button"
      data-phase={phase}
      onClick={() => {
        // Mirrors the real AudioRecorder's send(): it awaits onRecorded and
        // swallows a rejection itself (the parent owns the error), so the
        // fake must not leave an unhandled rejection here either.
        onRecorded(new Blob(['abc']), 'audio/webm', 3).catch(() => {});
      }}
    >
      fake-record
    </button>
  ),
}));

import {
  deleteBriefingAudio,
  fetchBriefing,
  retryBriefingTranscription,
  submitBriefingAnswer,
} from '../../api';
import { uploadBriefingAudio } from '../../services/briefingAudio';
import { BriefingPage } from '../BriefingPage';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function renderPage(page: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter>{page}</MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

const audio = {
  url: 'https://get/x.webm',
  mime: 'audio/webm',
  duration_seconds: 65,
  transcription_status: 'failed' as const,
  recorded_at: '2026-09-03T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(fetchBriefing).mockResolvedValue({
    briefings: [
      {
        id: 'b1',
        title: 'Briefing',
        display_order: 0,
        questions: [
          {
            id: 'q1',
            question: 'Marca?',
            answer: 'Antes.',
            section: null,
            display_order: 0,
            audio: null,
          },
          { id: 'q2', question: 'Público?', answer: null, section: null, display_order: 1, audio },
        ],
      },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

describe('BriefingPage audio', () => {
  it('locks the textarea while uploading and fills it with the returned answer', async () => {
    let resolveUpload!: (v: unknown) => void;
    vi.mocked(uploadBriefingAudio).mockImplementation(
      () =>
        new Promise((r) => {
          resolveUpload = r;
        }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });
    expect(textareas[0]).toBeDisabled();

    await act(async () => {
      resolveUpload({
        ok: true,
        answer: 'Antes.\n\nTranscrito.',
        transcript: 'Transcrito.',
        audio: { ...audio, transcription_status: 'done' },
      });
    });
    await waitFor(() => expect(textareas[0]).not.toBeDisabled());
    expect(textareas[0]).toHaveValue('Antes.\n\nTranscrito.');
  });

  it('shows the audio player, failed status with retry, and remove', async () => {
    vi.mocked(retryBriefingTranscription).mockResolvedValue({
      ok: true,
      answer: 'Novo',
      transcript: 'Novo',
      audio: { ...audio, transcription_status: 'done' },
    });
    vi.mocked(deleteBriefingAudio).mockResolvedValue({ ok: true });
    renderPage(<BriefingPage />);
    await screen.findByText('Público?');

    expect(screen.getByText('player 65s')).toBeInTheDocument();
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    });
    expect(retryBriefingTranscription).toHaveBeenCalledWith('token-publico', 'q2');
    await waitFor(() => expect(screen.getAllByRole('textbox')[1]).toHaveValue('Novo'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remover áudio/i }));
    });
    expect(deleteBriefingAudio).toHaveBeenCalledWith('token-publico', 'q2');
  });

  it('renders an upload/transcription failure exactly once and re-enables the textarea', async () => {
    vi.mocked(uploadBriefingAudio).mockRejectedValue(
      new Error('Áudio maior que 15 MB. Grave um trecho mais curto.'),
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    await waitFor(() => expect(screen.getAllByText(/áudio maior que 15 mb/i)).toHaveLength(1));
    expect(textareas[0]).not.toBeDisabled();
  });

  it('surfaces text-save failures instead of swallowing them', async () => {
    vi.mocked(submitBriefingAnswer).mockRejectedValue(new Error('HTTP 500'));
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    // Fake timers only after the initial data fetch resolves: `findByText`
    // relies on @testing-library/react's async wrapper, which drains its
    // queue via a real `setTimeout(...,0)` it never recognizes as vitest
    // fake timers (it only detects a global `jest`), so it hangs if fake
    // timers are already active. See contentPages.test.tsx for the same
    // pattern.
    vi.useFakeTimers();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Novo texto' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.getByText(/não foi possível salvar/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
