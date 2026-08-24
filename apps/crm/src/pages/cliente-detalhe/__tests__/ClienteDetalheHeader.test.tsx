import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ClienteDetalheHeader } from '../ClienteDetalheHeader';

// ClienteAvatarUpload (rendered inside the header) calls useQueryClient()
// unconditionally, so every render needs a QueryClientProvider ancestor even
// when canEditPhoto is false and the interactive avatar never mounts.
function renderHeader(props: React.ComponentProps<typeof ClienteDetalheHeader>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClienteDetalheHeader {...props} />
    </QueryClientProvider>,
  );
}

describe('ClienteDetalheHeader', () => {
  it('keeps identity, badges, and actions in separate layout regions', () => {
    const onBack = vi.fn();
    const onEdit = vi.fn();
    renderHeader({
      clienteId: 1,
      nome: 'Ana Beatriz Gois Bessa',
      initials: 'AB',
      cor: '#eab308',
      plano: 'Social + Vídeo',
      status: 'ativo',
      canEditPhoto: false,
      onBack,
      onEdit,
    });

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

  it('shows the photo-upload control only when canEditPhoto is true', () => {
    renderHeader({
      clienteId: 7,
      nome: 'Ana Beatriz Gois Bessa',
      initials: 'AB',
      cor: '#eab308',
      plano: 'Social + Vídeo',
      status: 'ativo',
      canEditPhoto: true,
      onBack: vi.fn(),
      onEdit: vi.fn(),
    });
    expect(screen.getByLabelText('Alterar foto do cliente')).toBeInTheDocument();
  });
});
