import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ConversationList } from '../ConversationList';
import type { MensagemConversa } from '@/store';

const CONVERSAS: MensagemConversa[] = [
  {
    cliente_id: 14,
    cliente_nome: 'ACME',
    cliente_foto_url: null,
    last_source: 'mensagem',
    last_action: null,
    last_content: 'Obrigado!',
    last_is_workspace_user: false,
    last_author_name: null,
    last_created_at: '2026-07-30T12:00:00.000Z',
    unread_count: 2,
  },
  {
    cliente_id: 15,
    cliente_nome: 'Beta Corp',
    cliente_foto_url: 'https://cdn.example.com/beta.png',
    last_source: 'post_feedback',
    last_action: 'mensagem',
    last_content: 'Segue o ajuste combinado.',
    last_is_workspace_user: true,
    last_author_name: 'Ana',
    last_created_at: '2026-07-31T09:00:00.000Z',
    unread_count: 0,
  },
];

function renderList(overrides: Partial<ComponentProps<typeof ConversationList>> = {}) {
  const onSelect = vi.fn();
  const { unmount } = render(
    <ConversationList
      conversas={CONVERSAS}
      isLoading={false}
      isError={false}
      selectedClienteId={null}
      clientesById={new Map()}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect, unmount };
}

describe('ConversationList', () => {
  it('renders rows with preview, unread badge and agency prefix', () => {
    renderList();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.getByText('Ana: Segue o ajuste combinado.')).toBeInTheDocument();
    expect(screen.getByTestId('conversa-14')).toHaveTextContent('2');
  });

  it('marks the selected conversation as active and others as not', () => {
    renderList({ selectedClienteId: 15 });
    expect(screen.getByTestId('conversa-15').style.boxShadow).toContain('var(--primary-color)');
    expect(screen.getByTestId('conversa-14').style.boxShadow).toBe('');
  });

  it('calls onSelect with the clicked cliente_id', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByTestId('conversa-14'));
    expect(onSelect).toHaveBeenCalledWith(14);
  });

  it('sorts by recency by default and flips to oldest', () => {
    renderList();
    expect(
      screen.getByTestId('conversa-15').compareDocumentPosition(screen.getByTestId('conversa-14')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy(); // Beta Corp (jul 31) renders before ACME (jul 30)
    fireEvent.click(screen.getByRole('button', { name: /Mais recentes/ }));
    expect(
      screen.getByTestId('conversa-14').compareDocumentPosition(screen.getByTestId('conversa-15')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('filters by client name', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'acm' } });
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.queryByText('Beta Corp')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum cliente encontrado.')).toBeInTheDocument();
  });

  it('uses the Instagram profile picture as the client avatar when available', () => {
    renderList();
    expect(screen.getByTestId('cliente-avatar-foto')).toHaveAttribute(
      'src',
      'https://cdn.example.com/beta.png',
    );
  });

  it('shows loading and error copy', () => {
    const { unmount } = renderList({ isLoading: true });
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    unmount();
    renderList({ isError: true });
    expect(screen.getByText('Não foi possível carregar as conversas.')).toBeInTheDocument();
  });
});
