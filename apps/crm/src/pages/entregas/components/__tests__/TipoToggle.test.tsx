import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TipoToggle } from '../TipoToggle';

describe('TipoToggle', () => {
  it('renders one icon-only radio per tipo inside a Tipo group, the current one checked', () => {
    render(<TipoToggle value="carrossel" lockedReason={null} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Tipo' })).toBeInTheDocument();
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Imagem', 'Carrossel', 'Vídeo vertical', 'Stories']);
    expect(screen.getByRole('radio', { name: 'Carrossel' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Carrossel' })).toHaveTextContent('');
  });

  it('changes tipo and never deselects the current one', () => {
    const onChange = vi.fn();
    render(<TipoToggle value="feed" lockedReason={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Imagem' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Stories' }));
    expect(onChange).toHaveBeenCalledWith('stories');
  });

  it('locks every option with the reason in the tooltip', async () => {
    render(
      <TipoToggle
        value="feed"
        lockedReason="Cancelar agendamento para editar"
        onChange={vi.fn()}
      />,
    );
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
    fireEvent.pointerMove(screen.getByRole('radio', { name: 'Stories' }).parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'StoriesCancelar agendamento para editar',
    );
  });
});
