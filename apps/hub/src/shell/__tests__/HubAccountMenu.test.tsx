import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HubAccountMenu } from '../HubAccountMenu';

const PERSON = { nome: 'Marina Costa', email: 'marina@clinicavida.com.br' };

describe('HubAccountMenu', () => {
  it('shows the initials on a labelled trigger', () => {
    render(<HubAccountMenu person={PERSON} onSignOut={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Conta de Marina Costa' });
    expect(trigger).toHaveTextContent('MC');
    expect(screen.queryByText('Sair')).not.toBeInTheDocument();
  });

  it('opens to show name, email and sign out, and signs out', () => {
    const onSignOut = vi.fn();
    render(<HubAccountMenu person={PERSON} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Conta de Marina Costa' }));
    expect(screen.getByText('Marina Costa')).toBeInTheDocument();
    expect(screen.getByText('marina@clinicavida.com.br')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<HubAccountMenu person={PERSON} onSignOut={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Conta de Marina Costa' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Sair')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('falls back to the email initial when the name is empty', () => {
    render(<HubAccountMenu person={{ nome: '', email: 'ze@x.com' }} onSignOut={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Conta de/ })).toHaveTextContent('Z');
  });

  it('keeps a 44px tap area around a smaller trigger', () => {
    const { unmount } = render(<HubAccountMenu person={PERSON} onSignOut={vi.fn()} size={32} />);
    const hit = screen
      .getByRole('button', { name: 'Conta de Marina Costa' })
      .querySelector<HTMLElement>('[data-hit-area]');
    expect(hit).not.toBeNull();
    expect(hit!.style.inset).toBe('-6px');
    unmount();
    render(<HubAccountMenu person={PERSON} onSignOut={vi.fn()} />);
    expect(
      screen
        .getByRole('button', { name: 'Conta de Marina Costa' })
        .querySelector('[data-hit-area]'),
    ).toBeNull();
  });
});
