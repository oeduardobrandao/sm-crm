import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RascunhoBanner } from '../RascunhoBanner';

function setup(kind: 'fluxo' | 'post' = 'fluxo', { count = 4, busy = false } = {}) {
  const onReset = vi.fn();
  const onDismiss = vi.fn();
  render(
    <RascunhoBanner
      count={count}
      entityKind={kind}
      busy={busy}
      onReset={onReset}
      onDismiss={onDismiss}
    />,
  );
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
    expect(
      screen.getByText(
        'Ele sai de Aprovado e volta para Rascunho. O histórico de aprovações é mantido.',
      ),
    ).toBeTruthy();
  });
  it('fluxo com um post usa o singular na confirmação', () => {
    setup('fluxo', { count: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar todos para rascunho' }));
    expect(
      screen.getByText(
        'Ele sai de Aprovado e volta para Rascunho. O histórico de aprovações é mantido.',
      ),
    ).toBeTruthy();
  });
  it('fluxo com vários posts usa o plural na confirmação', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar todos para rascunho' }));
    expect(
      screen.getByText(
        'Eles saem de Aprovado e voltam para Rascunho. O histórico de aprovações é mantido.',
      ),
    ).toBeTruthy();
  });
  it('X fica desabilitado enquanto ocupado', () => {
    const { onDismiss } = setup('fluxo', { busy: true });
    const x = screen.getByRole('button', { name: 'Dispensar aviso' }) as HTMLButtonElement;
    expect(x.disabled).toBe(true);
    fireEvent.click(x);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
