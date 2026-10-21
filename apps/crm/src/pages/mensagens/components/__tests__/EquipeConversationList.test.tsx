import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { EquipeConversationList } from '../EquipeConversationList';
import type { EquipeConversa } from '@/store';

const CONVERSAS: EquipeConversa[] = [
  {
    conversa_id: 1,
    tipo: 'grupo',
    nome: 'Time de Criação',
    display_nome: 'Time de Criação',
    avatar_url: null,
    participantes_count: 4,
    last_author_name: null,
    last_author_id: null,
    last_content: 'Obrigado!',
    last_has_anexo: false,
    last_created_at: '2026-07-30T12:00:00.000Z',
    last_message_id: 10,
    unread_count: 2,
  },
  {
    conversa_id: 2,
    tipo: 'dm',
    nome: null,
    display_nome: 'Beta Ana',
    avatar_url: 'https://cdn.example.com/ana.png',
    participantes_count: 2,
    last_author_name: 'Ana',
    last_author_id: null,
    last_content: 'Segue o ajuste combinado.',
    last_has_anexo: false,
    last_created_at: '2026-07-31T09:00:00.000Z',
    last_message_id: 11,
    unread_count: 0,
  },
];

function renderList(overrides: Partial<ComponentProps<typeof EquipeConversationList>> = {}) {
  const onSelect = vi.fn();
  const onNovaConversa = vi.fn();
  const { unmount } = render(
    <EquipeConversationList
      conversas={CONVERSAS}
      isLoading={false}
      isError={false}
      selectedConversaId={null}
      currentUserId="u-eu"
      onSelect={onSelect}
      onNovaConversa={onNovaConversa}
      {...overrides}
    />,
  );
  return { onSelect, onNovaConversa, unmount };
}

describe('EquipeConversationList', () => {
  it('prefixes the current user\'s own last message with "Você"', () => {
    renderList({
      conversas: [{ ...CONVERSAS[1], last_author_name: 'Eu Mesmo', last_author_id: 'u-eu' }],
    });
    expect(screen.getByText('Você: Segue o ajuste combinado.')).toBeInTheDocument();
    expect(screen.queryByText(/Eu Mesmo:/)).toBeNull();
  });

  // jsdom has no layout, so the phone overflow (the list measuring ~524px in a
  // 390px screen: time, unread badge and "+" pushed off-screen) can only be
  // guarded by the classes that fix it. Without min-w-0 a flex item's minimum
  // width is its nowrap content, so a long name or preview widened the column.
  it('lets long names and the column shrink (min-w-0) instead of widening the list', () => {
    const { container } = render(
      <EquipeConversationList
        conversas={CONVERSAS}
        isLoading={false}
        isError={false}
        selectedConversaId={null}
        currentUserId={null}
        onSelect={vi.fn()}
        onNovaConversa={vi.fn()}
      />,
    );
    expect(container.firstElementChild).toHaveClass('min-w-0');
    const nome = screen.getByText('Time de Criação');
    expect(nome).toHaveClass('truncate');
    expect(nome).toHaveClass('min-w-0');
  });

  it('renders rows with preview, unread badge and author prefix', () => {
    renderList();
    expect(screen.getByText('Time de Criação')).toBeInTheDocument();
    expect(screen.getByText('Equipe: Obrigado!')).toBeInTheDocument();
    expect(screen.getByText('Ana: Segue o ajuste combinado.')).toBeInTheDocument();
    expect(screen.getByTestId('equipe-conversa-1')).toHaveTextContent('2');
  });

  it('marks the selected conversation as active and others as not', () => {
    renderList({ selectedConversaId: 2 });
    expect(screen.getByTestId('equipe-conversa-2').style.boxShadow).toContain(
      'var(--primary-color)',
    );
    expect(screen.getByTestId('equipe-conversa-1').style.boxShadow).toBe('');
  });

  it('calls onSelect with the clicked conversa_id', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByTestId('equipe-conversa-1'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('sorts by recency by default and flips to oldest', () => {
    renderList();
    expect(
      screen
        .getByTestId('equipe-conversa-2')
        .compareDocumentPosition(screen.getByTestId('equipe-conversa-1')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy(); // Beta Ana (jul 31) renders before Time de Criação (jul 30)
    fireEvent.click(screen.getByRole('button', { name: /Mais recentes/ }));
    expect(
      screen
        .getByTestId('equipe-conversa-1')
        .compareDocumentPosition(screen.getByTestId('equipe-conversa-2')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('filters by conversation name', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Buscar conversa'), { target: { value: 'time' } });
    expect(screen.getByText('Time de Criação')).toBeInTheDocument();
    expect(screen.queryByText('Beta Ana')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar conversa'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhuma conversa encontrada.')).toBeInTheDocument();
  });

  it('uses the avatar photo for a DM and a group icon for a grupo', () => {
    renderList();
    expect(screen.getByTestId('equipe-conversa-2').querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/ana.png',
    );
    expect(screen.getByTestId('equipe-conversa-1').querySelector('img')).not.toBeInTheDocument();
  });

  it('calls onNovaConversa when the new-conversation button is clicked', () => {
    const { onNovaConversa } = renderList();
    fireEvent.click(screen.getByTestId('nova-conversa-btn'));
    expect(onNovaConversa).toHaveBeenCalledTimes(1);
  });

  it('shows loading and error copy', () => {
    const { unmount } = renderList({ isLoading: true });
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    unmount();
    renderList({ isError: true });
    expect(screen.getByText('Não foi possível carregar as conversas.')).toBeInTheDocument();
  });

  it('shows the empty state when there are no conversations', () => {
    renderList({ conversas: [] });
    expect(
      screen.getByText('Nenhuma conversa ainda. Crie uma para falar com a equipe.'),
    ).toBeInTheDocument();
  });
});
