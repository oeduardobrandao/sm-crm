import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DestinationToggles } from '../DestinationToggles';

const opts = [
  { platform: 'instagram' as const, on: true, disabledReason: null },
  {
    platform: 'tiktok' as const,
    on: false,
    disabledReason: 'Stories não são suportados no TikTok',
  },
  { platform: 'geral' as const, on: false, disabledReason: null },
];

describe('DestinationToggles', () => {
  it('renders one pressed/unpressed toggle per option inside a Destinos group', () => {
    render(
      <DestinationToggles options={opts} lockedReason={null} pending={false} onToggle={vi.fn()} />,
    );
    const group = screen.getByRole('group', { name: 'Destinos' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instagram/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Geral/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns a destination on and off', () => {
    const onToggle = vi.fn();
    render(
      <DestinationToggles
        options={[...opts.slice(0, 1), { ...opts[2], on: true }]}
        lockedReason={null}
        pending={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onToggle).toHaveBeenCalledWith('geral', false);
  });

  it('disables an option that cannot be turned on, with the reason as title', () => {
    render(
      <DestinationToggles options={opts} lockedReason={null} pending={false} onToggle={vi.fn()} />,
    );
    const tt = screen.getByRole('button', { name: /TikTok/ });
    expect(tt).toBeDisabled();
    expect(tt.parentElement).toHaveAttribute('title', 'Stories não são suportados no TikTok');
  });

  it('refuses to turn off the last destination', () => {
    const onToggle = vi.fn();
    render(
      <DestinationToggles
        options={[opts[0]]}
        lockedReason={null}
        pending={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Instagram/ }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('O post precisa de pelo menos um destino.')).toBeInTheDocument();
  });

  it('locks every toggle while scheduled', () => {
    render(
      <DestinationToggles
        options={opts}
        lockedReason="Cancelar agendamento para editar"
        pending={false}
        onToggle={vi.fn()}
      />,
    );
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('a published destination is disabled with its reason (turning off)', () => {
    render(
      <DestinationToggles
        options={[
          { platform: 'instagram', on: true, disabledReason: 'Já publicado' },
          { platform: 'geral', on: true, disabledReason: null },
        ]}
        lockedReason={null}
        pending={false}
        onToggle={vi.fn()}
      />,
    );
    const ig = screen.getByRole('button', { name: /Instagram/ });
    expect(ig).toBeDisabled();
    expect(ig.parentElement).toHaveAttribute('title', 'Já publicado');
  });

  it('renders nothing for an Express post (no options)', () => {
    const { container } = render(
      <DestinationToggles options={[]} lockedReason={null} pending={false} onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
