import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDocumentTitle, DEFAULT_TITLES } from '../AppDocumentTitle';

function mount() {
  return render(
    <MemoryRouter initialEntries={['/clientes']}>
      <AppDocumentTitle />
    </MemoryRouter>,
  );
}

describe('AppDocumentTitle', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('swaps the static Portuguese title for the English default in English', async () => {
    await i18n.changeLanguage('en');
    document.title = DEFAULT_TITLES.pt;
    mount();
    expect(document.title).toBe(DEFAULT_TITLES.en);
    expect(DEFAULT_TITLES.en).toBe('Mesaas: Social Media CRM and Client Approvals for Agencies');
  });

  it('keeps the Portuguese default in Portuguese', () => {
    document.title = DEFAULT_TITLES.pt;
    mount();
    expect(document.title).toBe(DEFAULT_TITLES.pt);
  });

  it('leaves a title set by the page alone', async () => {
    await i18n.changeLanguage('en');
    document.title = 'Deliveries | Mesaas';
    mount();
    expect(document.title).toBe('Deliveries | Mesaas');
  });
});
