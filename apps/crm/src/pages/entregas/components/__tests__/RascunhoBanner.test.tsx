import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RascunhoBanner } from '../RascunhoBanner';

function setup(kind: 'fluxo' | 'post' = 'fluxo') {
  const onReset = vi.fn();
  const onDismiss = vi.fn();
  render(<RascunhoBanner count={4} entityKind={kind} onReset={onReset} onDismiss={onDismiss} />);
  return { onReset, onDismiss };
}

describe('RascunhoBanner', () => {
  it('mostra a cópia do fluxo', () => {
    setup();
    expect(screen.getByText('4 posts continuam aprovados.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/—/);
  });
  it('X dispensa sem confirmação', () => {
    const { onDismiss, onReset } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });
  it('onReset só roda depois de confirmar', () => {
    const { onReset } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar todos para rascunho' }));
    expect(screen.getByText('Voltar 4 posts para rascunho?')).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para rascunho' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
  it('variante post', () => {
    setup('post');
    expect(screen.getByText('Este post continua aprovado.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para rascunho' }));
    expect(screen.getByText('Voltar o post para rascunho?')).toBeTruthy();
  });
});
