import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResult, mockFrom, mockEq, mockGetContaId } = vi.hoisted(() => ({
  mockResult: vi.fn(),
  mockFrom: vi.fn(),
  mockEq: vi.fn(),
  mockGetContaId: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table);
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            mockEq(col, val);
            return mockResult();
          },
        }),
      };
    },
  },
  getContaId: mockGetContaId,
  getUserId: vi.fn().mockResolvedValue('u1'),
}));

import { getWorkspaceMemberClienteIds } from '../workspace';

describe('getWorkspaceMemberClienteIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
  });

  it('groups every assignment of the active workspace by member in one query', async () => {
    mockResult.mockResolvedValue({
      data: [
        { user_id: 'u2', cliente_id: 1 },
        { user_id: 'u2', cliente_id: '3' },
        { user_id: 'u3', cliente_id: 2 },
      ],
      error: null,
    });
    await expect(getWorkspaceMemberClienteIds()).resolves.toEqual({ u2: [1, 3], u3: [2] });
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('workspace_member_clientes');
    expect(mockEq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });

  it('returns an empty map when there are no rows', async () => {
    mockResult.mockResolvedValue({ data: null, error: null });
    await expect(getWorkspaceMemberClienteIds()).resolves.toEqual({});
  });

  it('throws on a query error (fail closed, never an empty map)', async () => {
    mockResult.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getWorkspaceMemberClienteIds()).rejects.toEqual({ message: 'boom' });
  });
});
