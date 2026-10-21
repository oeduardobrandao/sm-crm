import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const buscarMock = vi.fn();
vi.mock('../geoAutocomplete', () => ({
  MIN_TEXTO_ENDERECO: 3,
  buscarEnderecos: (...args: unknown[]) => buscarMock(...args),
}));

import { LocalAutocomplete } from '../LocalAutocomplete';

const SUGESTOES = [
  {
    rotulo: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP, Brasil',
    linha1: 'Av. Paulista, 1000',
    linha2: 'Bela Vista, São Paulo - SP, Brasil',
  },
  { rotulo: 'Rua Augusta, 500 - São Paulo - SP, Brasil', linha1: 'Rua Augusta, 500', linha2: '' },
];

function Campo({
  inicial = '',
  onSubmit = () => {},
}: {
  inicial?: string;
  onSubmit?: (v: string) => void;
}) {
  const [v, setV] = useState(inicial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <LocalAutocomplete value={v} onChange={setV} aria-label="Local" debounceMs={0} />
      <output data-testid="valor">{v}</output>
    </form>
  );
}

function renderCampo(props: Parameters<typeof Campo>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Campo {...props} />
    </QueryClientProvider>,
  );
}

const input = () => screen.getByRole('combobox', { name: 'Local' });

function digitar(texto: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value: texto } });
}

beforeEach(() => {
  buscarMock.mockReset();
  buscarMock.mockResolvedValue(SUGESTOES);
});
afterEach(() => vi.restoreAllMocks());

describe('LocalAutocomplete', () => {
  it('shows address suggestions after typing 3+ characters', async () => {
    renderCampo();
    digitar('pau');
    expect(await screen.findByRole('listbox', { name: 'Sugestões de endereço' })).toBeVisible();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Av. Paulista, 1000')).toBeVisible();
    expect(screen.getByText('Bela Vista, São Paulo - SP, Brasil')).toBeVisible();
    expect(buscarMock).toHaveBeenCalledWith('pau', expect.anything());
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Powered by Geoapify' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('does not search below 3 characters', async () => {
    renderCampo();
    digitar('pa');
    await new Promise((r) => setTimeout(r, 20));
    expect(buscarMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clicking a suggestion fills the full address and closes the list', async () => {
    renderCampo();
    digitar('pau');
    fireEvent.click(await screen.findByText('Rua Augusta, 500'));
    expect(screen.getByTestId('valor')).toHaveTextContent(
      'Rua Augusta, 500 - São Paulo - SP, Brasil',
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(buscarMock).toHaveBeenCalledTimes(1);
  });

  it('arrow keys + Enter pick a suggestion without submitting the form', async () => {
    const onSubmit = vi.fn();
    renderCampo({ onSubmit });
    digitar('pau');
    await screen.findByRole('listbox');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('valor')).toHaveTextContent(SUGESTOES[0].rotulo);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape closes the list and does not reach document listeners (popover/dialog stay open)', async () => {
    const docEsc = vi.fn();
    document.addEventListener('keydown', docEsc, true);
    try {
      renderCampo();
      digitar('pau');
      await screen.findByRole('listbox');
      fireEvent.keyDown(input(), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(docEsc).not.toHaveBeenCalled();
      // With the list closed, Escape behaves normally again.
      fireEvent.keyDown(input(), { key: 'Escape' });
      expect(docEsc).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', docEsc, true);
    }
  });

  it('keeps free text when the service fails, with no list', async () => {
    buscarMock.mockRejectedValue(new Error('geo-autocomplete 503'));
    renderCampo();
    digitar('Sala 2 do estúdio');
    await waitFor(() => expect(buscarMock).toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('valor')).toHaveTextContent('Sala 2 do estúdio');
  });

  it('does not search for a value that came from the form (editing an event)', async () => {
    renderCampo({ inicial: 'Av. Paulista, 1000' });
    fireEvent.focus(input());
    await new Promise((r) => setTimeout(r, 20));
    expect(buscarMock).not.toHaveBeenCalled();
  });

  it('after a pick, typing again never shows the previous list while the new one loads', async () => {
    renderCampo();
    digitar('pau');
    fireEvent.click(await screen.findByText('Rua Augusta, 500'));
    buscarMock.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(input(), { target: { value: 'Rua Augusta, 500 - São Paulo - SP, Brasil 2' } });
    // Before the debounce fires: the old term's cached list must not come back.
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(buscarMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps the current list while the next keystroke loads (no blink)', async () => {
    renderCampo();
    digitar('pau');
    await screen.findByRole('listbox');
    buscarMock.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(input(), { target: { value: 'paul' } });
    await waitFor(() => expect(buscarMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('listbox')).toBeVisible();
  });

  it('ArrowDown reopens a list closed with Escape', async () => {
    renderCampo();
    digitar('pau');
    await screen.findByRole('listbox');
    fireEvent.keyDown(input(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeVisible();
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
  });

  it('Enter during IME composition does not pick', async () => {
    renderCampo();
    digitar('pau');
    await screen.findByRole('listbox');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(screen.getByTestId('valor')).toHaveTextContent('pau');
  });

  it('blur closes the list', async () => {
    renderCampo();
    digitar('pau');
    await screen.findByRole('listbox');
    fireEvent.blur(input());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
