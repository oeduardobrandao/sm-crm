import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ThreadLoadError, ThreadLoading, ThreadNotFound, ThreadPlaceholder } from '../ThreadStatus';

describe('ThreadStatus', () => {
  it('ThreadPlaceholder shows the select-a-conversation hint', () => {
    render(<ThreadPlaceholder />);
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
  });

  it('ThreadNotFound links back to the conversation list', () => {
    render(
      <MemoryRouter>
        <ThreadNotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para as conversas' })).toHaveAttribute(
      'href',
      '/mensagens',
    );
  });

  it('ThreadNotFound shows a back button instead when onBack is provided', () => {
    const onBack = vi.fn();
    render(
      <MemoryRouter>
        <ThreadNotFound onBack={onBack} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ThreadLoading shows a loading message with no back affordance by default', () => {
    render(<ThreadLoading />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar para as conversas' })).not.toBeInTheDocument();
  });

  it('ThreadLoading shows a back button when onBack is provided', () => {
    const onBack = vi.fn();
    render(<ThreadLoading onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ThreadLoadError calls onRetry when clicked, and supports onBack', () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(<ThreadLoadError onRetry={onRetry} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
