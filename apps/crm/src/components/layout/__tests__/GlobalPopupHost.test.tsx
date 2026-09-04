import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  useGuideMock,
  getActivePopupsMock,
  getMyPopupInteractionsMock,
  recordPopupInteractionMock,
  resolveInlineImageUrlsMock,
  captureEventMock,
  navigateMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGuideMock: vi.fn(),
  getActivePopupsMock: vi.fn(),
  getMyPopupInteractionsMock: vi.fn(),
  recordPopupInteractionMock: vi.fn(),
  resolveInlineImageUrlsMock: vi.fn(),
  captureEventMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../guide/GuideContext', () => ({ useGuide: useGuideMock }));
vi.mock('../../../store/popups', () => ({
  getActivePopups: getActivePopupsMock,
  getMyPopupInteractions: getMyPopupInteractionsMock,
  recordPopupInteraction: recordPopupInteractionMock,
}));
vi.mock('../../../services/inlineImage', () => ({
  resolveInlineImageUrls: resolveInlineImageUrlsMock,
}));
vi.mock('../../../lib/analytics', () => ({ captureEvent: captureEventMock }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import GlobalPopupHost from '../GlobalPopupHost';

const popup = {
  id: 'p1',
  pages: [
    { title: 'Um', eyebrow: 'Novo', body: 'b1', image_key: 'contas/x/files/a.png' },
    { title: 'Dois', eyebrow: null, body: 'b2', image_key: null },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda/x',
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: false,
  created_at: '2026-09-01T00:00:00Z',
};

function renderHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalPopupHost openDelayMs={0} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GlobalPopupHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useAuthMock.mockReturnValue({ loading: false });
    useGuideMock.mockReturnValue({ autoOpen: 'no', isOpen: false });
    getActivePopupsMock.mockResolvedValue([popup]);
    getMyPopupInteractionsMock.mockResolvedValue([]);
    recordPopupInteractionMock.mockResolvedValue(undefined);
    resolveInlineImageUrlsMock.mockResolvedValue({ 'contas/x/files/a.png': 'https://img/a.png' });
  });

  it('abre o popup elegível, resolve a imagem, grava seen e captura popup_shown', async () => {
    renderHost();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Imagem decorativa (alt=""), sem role "img": consulte o DOM direto.
    expect(document.querySelector('[role="dialog"] img')).toHaveAttribute(
      'src',
      'https://img/a.png',
    );
    expect(resolveInlineImageUrlsMock).toHaveBeenCalledWith(['contas/x/files/a.png']);
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'seen'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_shown', { popup_id: 'p1', pages: 2 });
    expect(sessionStorage.getItem('mesaas_popup_shown')).toBe('p1');
  });

  it('não grava seen de novo quando já existe', async () => {
    getMyPopupInteractionsMock.mockResolvedValue([{ popup_id: 'p1', action: 'seen' }]);
    renderHost();
    await screen.findByRole('dialog');
    await waitFor(() =>
      expect(captureEventMock).toHaveBeenCalledWith('popup_shown', expect.anything()),
    );
    expect(recordPopupInteractionMock).not.toHaveBeenCalledWith('p1', 'seen');
  });

  it('navega entre páginas capturando popup_page; X grava closed com a página e fecha', async () => {
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(captureEventMock).toHaveBeenCalledWith('popup_page', { popup_id: 'p1', page: 1 });
    expect(screen.getByRole('heading', { level: 2, name: 'Dois' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'closed');
    expect(captureEventMock).toHaveBeenCalledWith('popup_closed', { popup_id: 'p1', page: 1 });
    expect(sessionStorage.getItem('mesaas_popup_closed:p1')).toBe('1');
  });

  it('CTA relativo grava cta, captura popup_cta e navega no router', async () => {
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    // `record` passa pelo mutate do TanStack: chega ao store no microtask seguinte.
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'cta'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_cta', { popup_id: 'p1' });
    expect(navigateMock).toHaveBeenCalledWith('/ajuda/x');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('CTA absoluto abre nova aba com noopener', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [popup.pages[1]], cta_url: 'https://x.y/z' },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(open).toHaveBeenCalledWith('https://x.y/z', '_blank', 'noopener,noreferrer');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('CTA com URL rejeitada pelo sanitizeUrl vira no-op (grava cta, fecha, não abre nada)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [popup.pages[1]], cta_url: 'https://user:pw@x.y/z' },
    ]);
    renderHost();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'cta'));
    expect(open).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('require_ack: sem X, Esc não fecha, Entendi grava ack', async () => {
    getActivePopupsMock.mockResolvedValue([
      { ...popup, pages: [popup.pages[1]], cta_label: null, cta_url: null, require_ack: true },
    ]);
    renderHost();
    const dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    await waitFor(() => expect(recordPopupInteractionMock).toHaveBeenCalledWith('p1', 'ack'));
    expect(captureEventMock).toHaveBeenCalledWith('popup_ack', { popup_id: 'p1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('espera enquanto o guia é unknown e pula a sessão quando é yes', async () => {
    useGuideMock.mockReturnValue({ autoOpen: 'unknown', isOpen: false });
    const { rerender } = renderHost();
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sessionStorage.getItem('mesaas_popup_skipped')).toBeNull();

    useGuideMock.mockReturnValue({ autoOpen: 'yes', isOpen: false });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GlobalPopupHost openDelayMs={0} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sessionStorage.getItem('mesaas_popup_skipped')).toBe('1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pula a sessão quando o guia já está aberto (mesmo com autoOpen no)', async () => {
    useGuideMock.mockReturnValue({ autoOpen: 'no', isOpen: true });
    renderHost();
    await waitFor(() => expect(sessionStorage.getItem('mesaas_popup_skipped')).toBe('1'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('erro na query não renderiza nada e não quebra', async () => {
    getActivePopupsMock.mockRejectedValue(new Error('boom'));
    renderHost();
    await act(async () => {});
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('imagem que falha ao assinar abre sem imagem', async () => {
    resolveInlineImageUrlsMock.mockRejectedValue(new Error('sign failed'));
    renderHost();
    await screen.findByRole('dialog');
    expect(document.querySelector('[role="dialog"] img')).toBeNull();
  });
});
