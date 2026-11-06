import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc },
  getContaId: vi.fn().mockResolvedValue('ws-1'),
  getUserId: vi.fn().mockResolvedValue('u1'),
}));

import { getClienteContexto } from '../clients';

describe('getClienteContexto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_cliente_contexto with the id and returns the single row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: 7, nome: 'Clínica Sol', sigla: 'CS', cor: '#ff0000', foto_url: null }],
      error: null,
    });
    await expect(getClienteContexto(7)).resolves.toEqual({
      id: 7,
      nome: 'Clínica Sol',
      sigla: 'CS',
      cor: '#ff0000',
      foto_url: null,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_cliente_contexto', { p_cliente_id: 7 });
  });

  it('returns null when the caller may not see the client (empty result)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(getClienteContexto(7)).resolves.toBeNull();
  });

  it('returns null on a null payload', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(getClienteContexto(7)).resolves.toBeNull();
  });

  it('throws on an rpc error so the caller decides how to degrade', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getClienteContexto(7)).rejects.toEqual({ message: 'boom' });
  });
});
