import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHistoryPanel, TextDiff } from '../PostHistoryPanel';
import { fetchPostHistory, submitApproval } from '../../api';
import type { HubPost, PostApproval, PostHistoryResponse } from '../../types';

const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  fetchPostHistory: fetchPostHistoryMock,
  submitApproval: submitApprovalMock,
}));

const mockedFetch = vi.mocked(fetchPostHistory);
const mockedSubmit = vi.mocked(submitApproval);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Campanha',
    tipo: 'feed',
    status: 'correcao_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'texto',
    scheduled_at: null,
    ig_caption: 'legenda v2',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...overrides,
  };
}

const listApprovals: PostApproval[] = [
  {
    id: 10,
    post_id: 7,
    action: 'correcao',
    comentario: 'ajustar',
    is_workspace_user: false,
    created_at: '2026-09-01T12:00:00.000Z',
  },
  {
    id: 12,
    post_id: 7,
    action: 'mensagem',
    comentario: 'oi',
    is_workspace_user: false,
    created_at: '2026-09-03T13:00:00.000Z',
  },
  {
    id: 13,
    post_id: 8,
    action: 'mensagem',
    comentario: 'outro post',
    is_workspace_user: false,
    created_at: '2026-09-03T13:00:00.000Z',
  },
  // team note from the CRM Mensagens page: hub-posts drops it server-side (Task 4b); the panel filters anyway as defense in depth
  {
    id: 14,
    post_id: 7,
    action: 'mensagem',
    comentario: 'nota interna',
    is_workspace_user: true,
    created_at: '2026-09-03T14:00:00.000Z',
  },
];

const fullHistory: PostHistoryResponse = {
  events: [
    {
      id: 1,
      to_status: 'enviado_cliente',
      source: 'team',
      created_at: '2026-09-01T10:00:00.000Z',
      post_approval_id: null,
      snapshot: { conteudo_plain: 'texto', ig_caption: 'legenda v1' },
    },
    {
      id: 2,
      to_status: 'correcao_cliente',
      source: 'client',
      created_at: '2026-09-01T12:00:00.000Z',
      post_approval_id: 10,
      snapshot: null,
    },
    {
      id: 3,
      to_status: 'enviado_cliente',
      source: 'team',
      created_at: '2026-09-02T10:00:00.000Z',
      post_approval_id: null,
      snapshot: { conteudo_plain: 'texto', ig_caption: 'legenda v2' },
    },
    {
      id: 4,
      to_status: 'correcao_cliente',
      source: 'team',
      created_at: '2026-09-02T11:00:00.000Z',
      post_approval_id: null,
      snapshot: null,
    },
  ],
  approvals: [
    {
      id: 10,
      action: 'correcao',
      comentario: 'ajustar',
      motivo: 'legenda',
      is_workspace_user: false,
      created_at: '2026-09-01T12:00:00.000Z',
    },
    {
      id: 12,
      action: 'mensagem',
      comentario: 'oi',
      motivo: null,
      is_workspace_user: false,
      created_at: '2026-09-03T13:00:00.000Z',
    },
    // would only appear if the endpoint regressed; the panel must still hide it
    {
      id: 14,
      action: 'mensagem',
      comentario: 'nota interna',
      motivo: null,
      is_workspace_user: true,
      created_at: '2026-09-03T14:00:00.000Z',
    },
  ],
};

describe('PostHistoryPanel', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedSubmit.mockReset();
  });

  it('renders nothing for a post in an internal status', () => {
    const { container } = render(
      <PostHistoryPanel post={makePost({ status: 'rascunho' })} token="tok" approvals={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows history for an em-produção post but no comment composer', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    render(
      <PostHistoryPanel
        post={makePost({ status: 'rascunho', em_producao: 'correcao' })}
        token="tok"
        approvals={[]}
        embedded
      />,
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByPlaceholderText('Escreva um comentário sobre este post'),
    ).not.toBeInTheDocument();
  });

  it('shows counts from the client rows of this post only and does not fetch while collapsed', () => {
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={listApprovals} />);
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // id 13 belongs to post 8 and id 14 is a team note: neither is counted
    expect(screen.getByText('1 decisões · 1 comentários')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('fetches once on expand and renders the Histórico tab with KPIs, versions, motivo and a caption diff', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    render(
      <PostHistoryPanel
        post={makePost({ media: [{ id: 1 } as never] })}
        token="tok"
        approvals={listApprovals}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('v1: enviado para aprovação')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith('tok', 7);

    expect(screen.getByText('2 rodada(s) de correção')).toBeInTheDocument();
    expect(screen.getByText('Tempo médio de resposta: 2 h')).toBeInTheDocument();
    expect(screen.getByText('v2: enviado para aprovação')).toBeInTheDocument();
    expect(screen.getByText('ajustar')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Legenda')).toBeInTheDocument();
    expect(screen.getAllByText('Equipe').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Correção solicitada').length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Ver alterações na legenda' }));
    expect(screen.getByText('v1').tagName).toBe('DEL');
    expect(screen.getByText('v2').tagName).toBe('INS');
    expect(screen.queryByText('oi')).not.toBeInTheDocument();
  });

  it('lets the client open the full text of every sent version, including the first', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    render(
      <PostHistoryPanel
        embedded
        post={makePost({ media: [{ id: 1 } as never] })}
        token="tok"
        approvals={listApprovals}
      />,
    );
    await screen.findByText('v1: enviado para aprovação');

    const buttons = screen.getAllByRole('button', { name: 'Ver versão completa' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(screen.getByText('legenda v1', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar versão' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver versão completa' })[0]);
    expect(screen.getByText('legenda v2', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows the whole body of a text-only post, even when it has no caption', async () => {
    mockedFetch.mockResolvedValue({
      events: [
        {
          id: 1,
          to_status: 'enviado_cliente',
          source: 'team',
          created_at: '2026-09-11T12:30:00.000Z',
          post_approval_id: null,
          snapshot: { conteudo_plain: 'TELA 1: CAPA\nSe eu tivesse melasma', ig_caption: null },
        },
      ],
      approvals: [],
    });
    render(
      <PostHistoryPanel
        embedded
        post={makePost({ media: [], ig_caption: null })}
        token="tok"
        approvals={[]}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver versão completa' }));
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && !!el.textContent?.includes('TELA 1: CAPA'),
      ),
    ).toHaveTextContent('Se eu tivesse melasma');
  });

  it('diffs a text-only post on its whole body, with a matching label', async () => {
    const send = (id: number, at: string, body: string) => ({
      id,
      to_status: 'enviado_cliente' as const,
      source: 'team' as const,
      created_at: at,
      post_approval_id: null,
      snapshot: { conteudo_plain: body, ig_caption: null },
    });
    mockedFetch.mockResolvedValue({
      events: [
        send(1, '2026-09-11T12:00:00.000Z', 'TELA 1\nprimeiro texto'),
        send(2, '2026-09-12T12:00:00.000Z', 'TELA 1\nsegundo texto'),
      ],
      approvals: [],
    });
    render(
      <PostHistoryPanel
        embedded
        post={makePost({ media: [], ig_caption: null })}
        token="tok"
        approvals={[]}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver alterações no texto' }));
    expect(screen.getByText('primeiro').tagName).toBe('DEL');
    expect(screen.getByText('segundo').tagName).toBe('INS');
  });

  it('embedded: fetches on mount and renders no toggle header', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    render(<PostHistoryPanel embedded post={makePost()} token="tok" approvals={listApprovals} />);
    expect(await screen.findByText('v1: enviado para aprovação')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Histórico e comentários/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Histórico' })).toBeInTheDocument();
  });

  it('shows "sem dados ainda" instead of 0 when no send has a response', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('Tempo médio de resposta: sem dados ainda')).toBeInTheDocument();
    expect(screen.getByText('Nenhum evento registrado ainda.')).toBeInTheDocument();
  });

  it('shows the load error when the fetch rejects', async () => {
    mockedFetch.mockRejectedValue(new Error('HTTP 500'));
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeInTheDocument();
  });

  it('lists comments on the Comentários tab and sends a trimmed comment, then refetches', async () => {
    mockedFetch.mockResolvedValue(fullHistory);
    mockedSubmit.mockResolvedValue({ ok: true });
    const onCommentSent = vi.fn();
    render(
      <PostHistoryPanel
        post={makePost()}
        token="tok"
        approvals={listApprovals}
        onCommentSent={onCommentSent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    await screen.findByText('v1: enviado para aprovação');

    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }));
    expect(screen.getByText('oi')).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.queryByText('nota interna')).not.toBeInTheDocument();
    expect(screen.queryByText('Equipe')).not.toBeInTheDocument();

    const sendButton = screen.getByRole('button', { name: 'Enviar' });
    expect(sendButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Escreva um comentário sobre este post'), {
      target: { value: '  Perfeito, obrigado  ' },
    });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);

    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', 7, 'mensagem', 'Perfeito, obrigado'),
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(onCommentSent).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Escreva um comentário sobre este post')).toHaveValue('');
  });

  it('keeps the draft and shows an error when sending fails', async () => {
    mockedFetch.mockResolvedValue({ events: [], approvals: [] });
    mockedSubmit.mockRejectedValue(new Error('Escreva um comentário.'));
    render(<PostHistoryPanel post={makePost()} token="tok" approvals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    await screen.findByRole('tab', { name: 'Comentários' });
    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }));
    fireEvent.change(screen.getByPlaceholderText('Escreva um comentário sobre este post'), {
      target: { value: 'oi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Não foi possível enviar o comentário.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escreva um comentário sobre este post')).toHaveValue('oi');
  });
});

describe('TextDiff', () => {
  it('renders deletions as <del> and insertions as <ins>', () => {
    const { container } = render(<TextDiff before="bom dia time" after="boa tarde time" />);
    expect(container.querySelector('del')?.textContent).toContain('bom');
    expect(container.querySelector('ins')?.textContent).toContain('boa');
    expect(container.textContent).toContain(' time');
  });
});
