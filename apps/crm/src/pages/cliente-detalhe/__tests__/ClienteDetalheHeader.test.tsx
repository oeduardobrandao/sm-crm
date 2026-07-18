import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClienteDetalheHeader } from '../ClienteDetalheHeader';

describe('ClienteDetalheHeader', () => {
  it('keeps identity, badges, and actions in separate layout regions', () => {
    const onBack = vi.fn();
    const onEdit = vi.fn();
    render(
      <ClienteDetalheHeader
        nome="Ana Beatriz Gois Bessa"
        initials="AB"
        cor="#eab308"
        plano="Social + Vídeo"
        status="ativo"
        onBack={onBack}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ana Beatriz Gois Bessa' })).toHaveClass(
      'cliente-detalhe-header__name',
    );
    expect(screen.getByText('Social + Vídeo').parentElement).toHaveClass(
      'cliente-detalhe-header__badges',
    );

    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
