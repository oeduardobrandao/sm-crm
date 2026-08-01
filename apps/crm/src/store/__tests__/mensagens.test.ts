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

  it('throws on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMensagensFeed({})).rejects.toBeTruthy();
  });
});
