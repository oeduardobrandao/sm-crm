import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createIdeiaMock, getClientesMock, uploadMock, toastMock, limitsState } = vi.hoisted(() => ({
  createIdeiaMock: vi.fn(),
  getClientesMock: vi.fn(),
  uploadMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  limitsState: {
    features: { feature_briefing_audio: true } as { feature_briefing_audio: boolean } | null,
  },
}));

vi.mock('@/store', () => ({
  createIdeia: createIdeiaMock,
  getClientes: getClientesMock,
}));
vi.mock('@/services/ideiaAudio', () => ({ uploadIdeiaAudio: uploadMock }));
vi.mock('@/hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ membro: { id: 9 }, isLoading: false }),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsState.features, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@mesaas/ui/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  AudioRecorder: ({
    onRecorded,
    sendLabel,
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    sendLabel?: string;
  }) => (
    <button
      type="button"
      onClick={() => void onRecorded(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', 5)}
    >
      {`fake-recorder:${sendLabel}`}
    </button>
  ),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}));
// Radix Select does not open on fireEvent in jsdom; swap it for a native <select> here.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Cliente" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Selecione o cliente</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import React from 'react';
import { NovaIdeiaDialog } from '../NovaIdeiaDialog';

function renderDialog(onCreated = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NovaIdeiaDialog open onClose={() => {}} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

async function fillRequired() {
  const select = await screen.findByRole('combobox', { name: 'Cliente' });
  // getClientes resolves async; wait for the fetched options before indexing them.
  await waitFor(() => expect((select as HTMLSelectElement).options.length).toBeGreaterThan(1));
  // Clients are sorted pt-BR: Alfa Odonto (id 1) comes first.
  expect((select as HTMLSelectElement).options[1].text).toBe('Alfa Odonto');
  fireEvent.change(select, { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  Bastidores  ' } });
  fireEvent.change(screen.getByLabelText(/^Descrição/), { target: { value: 'Timelapse' } });
}

describe('NovaIdeiaDialog', () => {
  beforeEach(() => {
    createIdeiaMock.mockReset();
    // afterEach in test/vitest.setup.ts calls vi.restoreAllMocks(), which wipes a bare
    // vi.fn()'s mockResolvedValue back to undefined -- re-arm it every test, not just once
    // at the vi.mock() factory (matches the pattern in CalendarioPage.test.tsx).
    getClientesMock.mockReset().mockResolvedValue([
      { id: 2, nome: 'Zeta Clínica' },
      { id: 1, nome: 'Alfa Odonto' },
    ]);
    uploadMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    limitsState.features = { feature_briefing_audio: true };
    // NovaIdeiaDialog's link validation calls `new URL(value)`; spreading the real
    // URL constructor (`{ ...URL }`) drops its callable/constructor behavior and makes
    // every link fail validation. Subclassing keeps `new URL()` real while adding the
    // jsdom-missing statics the audio preview needs.
    class FakeURL extends URL {}
    (FakeURL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (FakeURL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    vi.stubGlobal('URL', FakeURL);
  });

  it('validates required fields and absolute http(s) links', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar ideia' }));
    expect(await screen.findByText('Selecione um cliente')).toBeInTheDocument();
    expect(screen.getByText('Título obrigatório')).toBeInTheDocument();
    expect(createIdeiaMock).not.toHaveBeenCalled();

    await fillRequired();
    fireEvent.change(screen.getByPlaceholderText('https://'), { target: { value: 'notion.so/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    expect(
      await screen.findByText('Informe um link completo, começando com https://'),
    ).toBeInTheDocument();
    expect(createIdeiaMock).not.toHaveBeenCalled();
  });

  it('requires a description or a recorded audio, but not both', async () => {
    renderDialog();
    const select = await screen.findByRole('combobox', { name: 'Cliente' });
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Bastidores' } });

    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    expect(
      await screen.findByText('Adicione uma descrição ou grave um áudio.'),
    ).toBeInTheDocument();
    expect(createIdeiaMock).not.toHaveBeenCalled();

    // Recording (not typing a description) clears the guard.
    createIdeiaMock.mockResolvedValue('new-id');
    fireEvent.click(await screen.findByRole('button', { name: 'fake-recorder:Usar este áudio' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    await waitFor(() => expect(createIdeiaMock).toHaveBeenCalled());
    expect(createIdeiaMock.mock.calls[0][0].descricao).toBeNull();
  });

  it('creates with visivel_no_hub false by default, trimmed fields and the current membro as author', async () => {
    createIdeiaMock.mockResolvedValue('new-id');
    const onCreated = renderDialog();
    await fillRequired();
    fireEvent.change(screen.getByPlaceholderText('https://'), {
      target: { value: ' https://notion.so/x ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    await waitFor(() =>
      expect(createIdeiaMock).toHaveBeenCalledWith({
        cliente_id: 1,
        titulo: 'Bastidores',
        descricao: 'Timelapse',
        links: ['https://notion.so/x'],
        visivel_no_hub: false,
        autor_membro_id: 9,
      }),
    );
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith('new-id');
    expect(toastMock.success).toHaveBeenCalledWith('Ideia criada.');
  });

  it('holds a recording and uploads it after create; audio failure warns but still closes', async () => {
    createIdeiaMock.mockResolvedValue('new-id');
    // describeAudioError special-cases "HTTP 5xx" to its own fixed message instead of the
    // caller's fallback (packages/ui/audio/validation.ts); use an unrecognized error so the
    // dialog's own fallback text is what's actually under test here.
    uploadMock.mockRejectedValue(new Error('boom'));
    const onCreated = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'fake-recorder:Usar este áudio' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    await fillRequired();
    fireEvent.click(screen.getByRole('switch', { name: /visível no hub/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar ideia' }));
    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith(
        expect.objectContaining({ ideiaId: 'new-id', mime: 'audio/webm', durationSeconds: 5 }),
      ),
    );
    expect(createIdeiaMock.mock.calls[0][0].visivel_no_hub).toBe(true);
    await waitFor(() =>
      expect(toastMock.warning).toHaveBeenCalledWith(
        'Ideia criada, mas o áudio falhou. Abra a ideia para tentar de novo.',
      ),
    );
    expect(onCreated).toHaveBeenCalledWith('new-id');
  });

  it('hides the recorder when the plan lacks audio', async () => {
    limitsState.features = { feature_briefing_audio: false };
    renderDialog();
    await screen.findByRole('button', { name: 'Criar ideia' });
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
  });
});
