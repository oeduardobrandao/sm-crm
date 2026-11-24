import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MensagemConversa, MensagemFeedItem } from '@/store';
import { ConversationThreadPhone } from '../ConversationThreadPhone';

const { mockPreview, mockMedia } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockMedia: vi.fn(),
}));

vi.mock('@/store', () => ({ getPostChipPreview: mockPreview }));
vi.mock('@/services/postMedia', () => ({ listPostMedia: mockMedia }));

beforeEach(() => {
  mockPreview.mockResolvedValue(null);
  mockMedia.mockResolvedValue([]);
});

const CONVERSA: MensagemConversa = {
  cliente_id: 14,
  cliente_nome: 'ACME',
  cliente_foto_url: null,
  last_source: 'mensagem',
  last_action: null,
  last_content: 'Obrigado!',
  last_is_workspace_user: false,
  last_author_name: null,
  last_created_at: '2026-07-30T12:00:00.000Z',
  unread_count: 0,
};

const CLIENT_MSG: MensagemFeedItem = {
  source: 'mensagem',
  item_id: 2,
  cliente_id: 14,
  cliente_nome: 'ACME',
  post_id: null,
  workflow_id: null,
  post_titulo: null,
  action: null,
  content: 'Obrigado!',
  is_workspace_user: false,
  author_user_id: null,
  author_name: null,
  author_avatar_url: null,
  created_at: '2026-07-30T12:00:00.000Z',
};

function renderPhone(items: MensagemFeedItem[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const feed = {
    data: { pages: [items] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ComponentProps<typeof ConversationThreadPhone>['feed'];
  const mutation = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ComponentProps<typeof ConversationThreadPhone>['sendGeneral'];
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ConversationThreadPhone
          conversa={CONVERSA}
          feed={feed}
          sendGeneral={mutation}
          replyToPost={mutation}
          clientesById={new Map()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ConversationThreadPhone author labels', () => {
  it('labels a client message with the Hub person who wrote it', () => {
    renderPhone([{ ...CLIENT_MSG, client_person_name: 'Marina Costa' }]);
    expect(screen.getByText('Marina Costa')).toBeInTheDocument();
  });

  it('shows no author label on a client message without a person name', () => {
    renderPhone([CLIENT_MSG]);
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.queryByText('Marina Costa')).not.toBeInTheDocument();
  });

  it('keeps the team author_name on a team row', () => {
    renderPhone([
      {
        ...CLIENT_MSG,
        is_workspace_user: true,
        author_name: 'Ana',
        client_person_name: 'Marina Costa',
      },
    ]);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Marina Costa')).not.toBeInTheDocument();
  });
});
