import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, planMock, captureEventMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  planMock: vi.fn(),
  captureEventMock: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/lib/analytics', () => ({ captureEvent: captureEventMock }));
vi.mock('../../../services/billing', () => ({ getEffectivePlanWithSource: planMock }));

/** whatsapp.ts reads env at module scope, so re-import per case. */
async function renderRow({
  number = '5511999999999',
  openedAt,
  onOpen = vi.fn(),
  compact,
}: { number?: string; openedAt?: string; onOpen?: () => void; compact?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', number);
  const { GuideWhatsAppRow } = await import('../GuideWhatsAppRow');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GuideWhatsAppRow openedAt={openedAt} onOpen={onOpen} compact={compact} />
    </QueryClientProvider>,
  );
  return { onOpen };
}

describe('GuideWhatsAppRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    useAuthMock.mockReturnValue({ profile: { nome: 'Ana Souza', empresa: 'Acme' } });
    planMock.mockResolvedValue({ billingCurrency: 'brl' });
  });

  it('mostra o convite com link para o WhatsApp num workspace em BRL', async () => {
    await renderRow();
    const link = await screen.findByRole('link', { name: /Abrir WhatsApp/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5511999999999\?text=/);
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Sou Ana, da Acme.');
    expect(screen.getByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
  });

  it('clique registra o evento com contexto guide e avisa o guia', async () => {
    const { onOpen } = await renderRow();
    fireEvent.click(await screen.findByRole('link', { name: /Abrir WhatsApp/ }));
    expect(captureEventMock).toHaveBeenCalledWith(
      'whatsapp_support_clicked',
      { context: 'guide' },
      { sendInstantly: true },
    );
    expect(onOpen).toHaveBeenCalled();
  });

  it('depois do clique mostra "Conversa aberta" e o botão "Abrir de novo"', async () => {
    await renderRow({ openedAt: '2026-11-26T12:00:00.000Z' });
    expect(await screen.findByRole('link', { name: 'Abrir de novo' })).toBeInTheDocument();
    expect(screen.getByText('Conversa aberta.')).toBeInTheDocument();
  });

  it('no celular o botão diz só "Abrir"', async () => {
    await renderRow({ compact: true });
    expect(await screen.findByRole('link', { name: 'Abrir' })).toBeInTheDocument();
  });

  it('não aparece num workspace em USD', async () => {
    planMock.mockResolvedValue({ billingCurrency: 'usd' });
    await renderRow();
    await vi.waitFor(() => expect(planMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('guide-whatsapp')).not.toBeInTheDocument();
  });

  it('não aparece enquanto a moeda carrega', async () => {
    planMock.mockReturnValue(new Promise(() => {}));
    await renderRow();
    expect(screen.queryByTestId('guide-whatsapp')).not.toBeInTheDocument();
  });

  it('erro ao ler o plano conta como BRL', async () => {
    planMock.mockRejectedValue(new Error('boom'));
    await renderRow();
    expect(await screen.findByTestId('guide-whatsapp')).toBeInTheDocument();
  });

  it('não aparece sem número de suporte configurado e nem consulta o plano', async () => {
    await renderRow({ number: '' });
    expect(screen.queryByTestId('guide-whatsapp')).not.toBeInTheDocument();
    expect(planMock).not.toHaveBeenCalled();
  });
});
