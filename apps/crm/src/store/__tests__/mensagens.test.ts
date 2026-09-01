import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, mockGetContaId, mockGetUserId } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUserId: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getContaId: mockGetContaId,
  getUserId: mockGetUserId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import {
  getMensagensFeed,
  getMensagensUnread,
  getMensagensConversas,
  getPostChipPreview,
  sendMensagem,
  markMensagensSeen,
} from '../mensagens';

describe('store/mensagens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockGetUserId.mockResolvedValue('user-1');
  });

  it('getMensagensFeed calls the RPC with cliente/cursor params', async () => {
    mockRpc.mockResolvedValue({ data: [{ source: 'mensagem', item_id: 1 }], error: null });
    const rows = await getMensagensFeed({
      clienteId: 14,
      cursor: { before: '2026-07-30T00:00:00Z', beforeSource: 'mensagem', beforeItemId: 9 },
    });
    expect(mockRpc).toHaveBeenCalledWith('get_mensagens_feed', {
      p_cliente_id: 14,
      p_before: '2026-07-30T00:00:00Z',
      p_before_source: 'mensagem',
      p_before_item_id: 9,
      p_limit: 50,
    });
    expect(rows).toHaveLength(1);
  });

  it('getMensagensUnread returns the per-cliente rows', async () => {
    mockRpc.mockResolvedValue({ data: [{ cliente_id: 14, unread_count: 3 }], error: null });
    const rows = await getMensagensUnread();
    expect(mockRpc).toHaveBeenCalledWith('get_mensagens_unread', {});
    expect(rows[0].unread_count).toBe(3);
  });

  it('sendMensagem inserts a workspace-authored row with author identity', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    await sendMensagem(14, 'Olá!');
    expect(mockFrom).toHaveBeenCalledWith('mensagens');
    expect(insert).toHaveBeenCalledWith({
      conta_id: 'ws-1',
      cliente_id: 14,
      content: 'Olá!',
      is_workspace_user: true,
      author_user_id: 'user-1',
    });
  });

  it('markMensagensSeen calls the RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await markMensagensSeen();
    expect(mockRpc).toHaveBeenCalledWith('mark_mensagens_seen', {});
  });

  it('getMensagensConversas calls the conversas RPC', async () => {
    mockRpc.mockResolvedValue({
      data: [{ cliente_id: 14, cliente_nome: 'ACME', unread_count: 2 }],
      error: null,
    });
    const rows = await getMensagensConversas();
    expect(mockRpc).toHaveBeenCalledWith('get_mensagens_conversas', {});
    expect(rows[0].cliente_nome).toBe('ACME');
  });

  it('getPostChipPreview selects the post with its fluxo (left embed) and flattens it', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 7,
        titulo: 'Post de julho',
        tipo: 'feed',
        status: 'aprovado_cliente',
        scheduled_at: null,
        workflow_id: 3,
        workflows: { titulo: 'Fluxo de agosto' },
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });
    const preview = await getPostChipPreview(7);
    expect(mockFrom).toHaveBeenCalledWith('workflow_posts');
    // Left embed (workflows(titulo), not workflows!inner): an avulso post has no
    // workflow row at all, so an inner join would silently drop it instead of
    // returning it with a null workflow_titulo (see the test below).
    expect(select).toHaveBeenCalledWith(
      'id, titulo, tipo, status, scheduled_at, workflow_id, workflows(titulo)',
    );
    expect(eq).toHaveBeenCalledWith('id', 7);
    expect(preview).toEqual({
      id: 7,
      titulo: 'Post de julho',
      tipo: 'feed',
      status: 'aprovado_cliente',
      scheduled_at: null,
      workflow_id: 3,
      workflow_titulo: 'Fluxo de agosto',
    });
  });

  it('getPostChipPreview maps an avulso post (no workflow) to a null workflow_id/workflow_titulo', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 8,
        titulo: 'Post avulso',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
        workflow_id: null,
        workflows: null,
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const preview = await getPostChipPreview(8);

    expect(preview).toEqual({
      id: 8,
      titulo: 'Post avulso',
      tipo: 'feed',
      status: 'rascunho',
      scheduled_at: null,
      workflow_id: null,
      workflow_titulo: null,
    });
  });

  it('getPostChipPreview returns null when the post is gone', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    expect(await getPostChipPreview(999)).toBeNull();
  });

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMensagensFeed({})).rejects.toBeTruthy();
  });
});
