import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PoliticaPage from '../PoliticaPage';

const launch = vi.hoisted(() => ({ live: true }));
vi.mock('../../../lib/googleLegalLaunch', () => ({
  get GOOGLE_LEGAL_TEXT_LIVE() {
    return launch.live;
  },
  legalNetworkList: () =>
    launch.live ? 'Instagram, TikTok, YouTube e Google Meu Negócio' : 'Instagram e TikTok',
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PoliticaPage />
    </MemoryRouter>,
  );
}

function section3(
  name = '3. Contas de redes sociais conectadas (Instagram, TikTok, YouTube e Google Meu Negócio)',
) {
  const heading = screen.getByRole('heading', { level: 2, name });
  return heading.parentElement as HTMLElement;
}

describe('PoliticaPage, Google text live', () => {
  beforeEach(() => {
    launch.live = true;
  });

  it('retitles section 3 to include YouTube and Google Meu Negócio', () => {
    renderPage();
    expect(section3()).toBeTruthy();
  });

  it('links the YouTube Terms, Google Privacy Policy and Google permissions page', () => {
    renderPage();
    const section = within(section3());
    for (const href of [
      'https://www.youtube.com/t/terms',
      'https://policies.google.com/privacy',
      'https://myaccount.google.com/permissions',
    ]) {
      const link = section.getAllByRole('link').find((a) => a.getAttribute('href') === href);
      expect(link, href).toBeDefined();
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link?.getAttribute('target')).toBe('_blank');
    }
    expect(section.getByText(/O Mesaas usa os Serviços de API do YouTube/)).toBeTruthy();
  });

  it('states the retention windows', () => {
    renderPage();
    const text = section3().textContent ?? '';
    expect(text).toMatch(
      /Ao desconectar \(no Mesaas ou no Google\), os dados do YouTube, inclusive os que estão em relatórios já gerados, são apagados em até 7 dias/,
    );
    expect(text).toMatch(
      /histórico do Google Meu Negócio é apagado 30 dias após a desconexão, mas os números e as avaliações em destaque que já estão em relatórios gerados permanecem nesses relatórios/,
    );
    expect(text).toMatch(/nome de exibição de quem avaliou/);
  });

  it('has no em dashes in the section copy', () => {
    renderPage();
    expect(section3().textContent).not.toContain('—');
  });
});

describe('PoliticaPage, Google text not launched', () => {
  beforeEach(() => {
    launch.live = false;
  });

  it('names only Instagram and TikTok and says nothing about Google', () => {
    const { container } = renderPage();
    const section = section3('3. Contas de redes sociais conectadas (Instagram e TikTok)');
    expect(section.textContent).not.toMatch(/YouTube|Google/);
    expect(container.textContent).not.toMatch(/YouTube|Google Meu Negócio|7 dias/);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('google.com') || h?.includes('youtube.com'))).toBe(false);
  });
});
