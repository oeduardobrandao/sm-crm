import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MensagensPage } from '../MensagensPage';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderPage() {
  return render(
    <HubContext.Provider
      value={{
        bootstrap: BOOTSTRAP,
        token: 'tok',
        workspace: 'ws',
        theme: 'light',
        toggleTheme: vi.fn(),
      }}
    >
      <MensagensPage />
    </HubContext.Provider>,
  );
}

describe('MensagensPage', () => {
  it('seeds fixture messages and appends a new one on send', () => {
    renderPage();
    expect(screen.getByText(/subi o reels/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/enviar mensagem/i);
    fireEvent.change(input, { target: { value: 'Perfeito, obrigado!' } });
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(screen.getByText('Perfeito, obrigado!')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('sends on Enter and ignores empty submissions', () => {
    renderPage();
    const input = screen.getByPlaceholderText(/enviar mensagem/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Oi!' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Oi!')).toBeInTheDocument();
  });
});
