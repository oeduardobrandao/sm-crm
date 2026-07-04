import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateImageMock = vi.fn();
vi.mock('../services/imageGen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/imageGen')>();
  return { ...actual, generateImage: (...a: unknown[]) => generateImageMock(...a) };
});

// The quota query hits supabase directly — stub the hook to a fixed snapshot.
vi.mock('../hooks/useAiImageQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAiImageQuota')>();
  return {
    ...actual,
    useAiImageQuota: (limit: number | null) => ({
      data: { used: 2, limit, resets_at: '2026-08-01T00:00:00.000Z' },
    }),
  };
});

// Seeding hooks touch the query cache / module map — no-op them for the render test.
vi.mock('../hooks/useImageUrls', () => ({ seedImageUrl: vi.fn() }));

import { GerarImagemPanel } from '../components/Dock/GerarImagemPanel';
import { ImageGenClientError } from '../services/imageGen';

function renderPanel(props: Partial<React.ComponentProps<typeof GerarImagemPanel>> = {}) {
  const onInsertLayer = vi.fn();
  const onSetBackground = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GerarImagemPanel
        postId={971}
        clienteId={42}
        hasBrandLogo
        canvasAspectRatio="4:5"
        monthlyLimit={50}
        onInsertLayer={onInsertLayer}
        onSetBackground={onSetBackground}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onInsertLayer, onSetBackground };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', { randomUUID: () => 'fixed-idem-key' });
});

describe('GerarImagemPanel', () => {
  it('defaults the AR to the canvas ratio and shows the quota meter', () => {
    renderPanel();
    // The canvas-AR chip (4:5) is active — its button carries the primary background.
    const chip45 = screen.getByRole('button', { name: '4:5' });
    expect(chip45).toHaveStyle({ background: 'var(--primary-color)' });
    expect(screen.getByTestId('estudio-ai-quota')).toHaveTextContent('2/50');
  });

  it('generate is disabled until there is a prompt', () => {
    renderPanel();
    expect(screen.getByTestId('estudio-ai-generate')).toBeDisabled();
    fireEvent.change(screen.getByTestId('estudio-ai-prompt'), {
      target: { value: 'fundo dourado' },
    });
    expect(screen.getByTestId('estudio-ai-generate')).not.toBeDisabled();
  });

  it('generates with placement-keyed request + idempotency key, then offers both insert actions', async () => {
    generateImageMock.mockResolvedValue({
      file_id: 900,
      preview_url: 'https://signed.example/ai.png',
      width: 1024,
      height: 1280,
      model: 'fake',
      cost_usd_estimate: 0.067,
      quota: { used: 3, limit: 50, resets_at: '2026-08-01T00:00:00.000Z' },
    });
    const { onInsertLayer, onSetBackground } = renderPanel();
    fireEvent.change(screen.getByTestId('estudio-ai-prompt'), {
      target: { value: 'fundo dourado abstrato' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fundo' })); // placement=background
    fireEvent.click(screen.getByTestId('estudio-ai-generate'));

    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(1));
    const req = generateImageMock.mock.calls[0][0];
    expect(req).toMatchObject({
      prompt: 'fundo dourado abstrato',
      aspect_ratio: '4:5',
      placement: 'background',
      client_id: 42,
      post_id: 971,
      idempotency_key: 'fixed-idem-key',
    });

    // Result preview + both insert buttons appear.
    await screen.findByTestId('estudio-ai-insert-layer');
    fireEvent.click(screen.getByTestId('estudio-ai-insert-layer'));
    expect(onInsertLayer).toHaveBeenCalledWith(900, { width: 1024, height: 1280 });
    fireEvent.click(screen.getByTestId('estudio-ai-set-background'));
    expect(onSetBackground).toHaveBeenCalledWith(900);
  });

  it('reuses the idempotency key across a retry, but mints a new one after success or a prompt edit', async () => {
    let uuidN = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `key-${++uuidN}` });
    generateImageMock
      .mockRejectedValueOnce(new ImageGenClientError('provider_timeout', 't', true))
      .mockResolvedValue({
        file_id: 900,
        preview_url: 'u',
        width: 1,
        height: 1,
        model: 'm',
        cost_usd_estimate: 0.067,
        quota: { used: 3, limit: 50, resets_at: '2026-08-01T00:00:00.000Z' },
      });
    renderPanel();
    fireEvent.change(screen.getByTestId('estudio-ai-prompt'), { target: { value: 'fundo' } });

    fireEvent.click(screen.getByTestId('estudio-ai-generate')); // attempt 1 → fails
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('estudio-ai-generate')); // retry → SAME key
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(2));
    expect(generateImageMock.mock.calls[0][0].idempotency_key).toBe('key-1');
    expect(generateImageMock.mock.calls[1][0].idempotency_key).toBe('key-1');

    // Editing the prompt retires the key; the next generation gets a fresh one.
    fireEvent.change(screen.getByTestId('estudio-ai-prompt'), { target: { value: 'outro fundo' } });
    fireEvent.click(screen.getByTestId('estudio-ai-generate'));
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(3));
    expect(generateImageMock.mock.calls[2][0].idempotency_key).toBe('key-2');
  });

  it('surfaces a §8 error code as inline PT copy (safety refusal)', async () => {
    generateImageMock.mockRejectedValue(
      new ImageGenClientError('safety_refusal', 'recusado', false),
    );
    renderPanel();
    fireEvent.change(screen.getByTestId('estudio-ai-prompt'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('estudio-ai-generate'));
    const err = await screen.findByTestId('estudio-ai-error');
    expect(err).toHaveTextContent(/recusou este prompt/i);
  });

  it('the brand-logo toggle only renders when the client has a materialized logo', () => {
    renderPanel({ hasBrandLogo: false });
    expect(screen.queryByText(/logo da marca/i)).not.toBeInTheDocument();
  });
});
