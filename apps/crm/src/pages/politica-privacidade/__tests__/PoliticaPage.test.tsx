import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PoliticaPage from '../PoliticaPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <PoliticaPage />
    </MemoryRouter>,
  );
}

function section3() {
  const heading = screen.getByRole('heading', {
    level: 2,
    name: '3. Contas de redes sociais conectadas (Instagram, TikTok, YouTube e Google Meu Negócio)',
  });
  return heading.parentElement as HTMLElement;
}

describe('PoliticaPage', () => {
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
