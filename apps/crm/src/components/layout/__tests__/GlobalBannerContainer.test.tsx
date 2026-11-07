import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useBannersMock } = vi.hoisted(() => ({ useBannersMock: vi.fn() }));
vi.mock('../../../hooks/useBanners', () => ({ useBanners: useBannersMock }));

import GlobalBannerContainer from '../GlobalBannerContainer';

const banner = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  type: 'info',
  content: 'Manutenção hoje às 22h',
  link: null,
  custom_color: null,
  dismissible: false,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

function setBanners(list: ReturnType<typeof banner>[]) {
  useBannersMock.mockReturnValue({ banners: list, dismiss: vi.fn() });
}

describe('GlobalBannerContainer', () => {
  beforeEach(() => setBanners([banner()]));

  it('renders a banner on the web', () => {
    render(<GlobalBannerContainer />);
    expect(screen.getByText('Manutenção hoje às 22h')).toBeInTheDocument();
  });

  it('renders a banner linking to /precos on the web', () => {
    setBanners([banner({ content: 'Veja os [planos](https://www.mesaas.com.br/precos)' })]);
    render(<GlobalBannerContainer />);
    expect(screen.getByRole('link', { name: 'planos' })).toBeInTheDocument();
  });

  describe('inside the iOS app', () => {
    beforeEach(() => {
      (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    });
    afterEach(() => {
      (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
    });

    it('hides a banner whose markdown body links to the pricing page', () => {
      setBanners([
        banner({ id: 'venda', content: 'Novo plano! [Veja](https://www.mesaas.com.br/precos)' }),
        banner({ id: 'aviso', content: 'Manutenção hoje às 22h' }),
      ]);
      render(<GlobalBannerContainer />);
      expect(screen.queryByText(/Novo plano/)).not.toBeInTheDocument();
      expect(screen.getByText('Manutenção hoje às 22h')).toBeInTheDocument();
    });

    it('hides a banner whose whole-bar link goes to billing', () => {
      setBanners([banner({ content: 'Atualize seu plano', link: '/configuracao/cobranca' })]);
      render(<GlobalBannerContainer />);
      expect(screen.queryByText('Atualize seu plano')).not.toBeInTheDocument();
    });

    it('keeps a plain banner', () => {
      render(<GlobalBannerContainer />);
      expect(screen.getByText('Manutenção hoje às 22h')).toBeInTheDocument();
    });

    it('still renders children (the stack slot) when every banner is hidden', () => {
      setBanners([banner({ link: 'https://mesaas.com.br/precos' })]);
      render(
        <GlobalBannerContainer>
          <div>filho</div>
        </GlobalBannerContainer>,
      );
      expect(screen.getByText('filho')).toBeInTheDocument();
      expect(screen.queryByText('Manutenção hoje às 22h')).not.toBeInTheDocument();
    });
  });
});
