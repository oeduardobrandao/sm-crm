import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock factories below run before this file's own top-level
// statements, so a plain `const mock... = vi.fn()` would still be in the TDZ
// when the factories execute.
const { mockGetTransacoes, mockGetClientes, mockGetMembros } = vi.hoisted(() => ({
  mockGetTransacoes: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetMembros: vi.fn(),
}));

vi.mock('../finance', () => ({ getTransacoes: mockGetTransacoes }));
vi.mock('../clients', () => ({ getClientes: mockGetClientes }));
vi.mock('../team', () => ({ getMembros: mockGetMembros }));

import { getDashboardStats } from '../computed';

describe('getDashboardStats', () => {
  beforeEach(() => {
    mockGetTransacoes.mockReset();
    mockGetClientes.mockReset().mockResolvedValue([]);
    mockGetMembros.mockReset().mockResolvedValue([]);
  });

  it('never fetches transacoes when the caller lacks financial access', async () => {
    // Regression: before Migration B lands, RLS still returns real rows here.
    // DashboardPage masks aReceber/aPagar behind `canSeeFinancials === true`,
    // but if the fetch still ran, the raw rows would sit in the network
    // response and the React Query cache — readable in devtools — for a
    // restricted caller.
    mockGetTransacoes.mockResolvedValue([
      { id: 1, valor: 999, tipo: 'entrada', data: '2026-07-01' },
    ]);

    const stats = await getDashboardStats(false);

    expect(mockGetTransacoes).not.toHaveBeenCalled();
    expect(stats.transacoes).toEqual([]);
  });

  it('never fetches transacoes while access is unknown', async () => {
    mockGetTransacoes.mockResolvedValue([
      { id: 1, valor: 999, tipo: 'entrada', data: '2026-07-01' },
    ]);

    const stats = await getDashboardStats('unknown');

    expect(mockGetTransacoes).not.toHaveBeenCalled();
    expect(stats.transacoes).toEqual([]);
  });

  it('fetches transacoes when the caller has financial access', async () => {
    mockGetTransacoes.mockResolvedValue([
      { id: 1, valor: 500, tipo: 'entrada', data: '2026-07-01' },
    ]);

    await getDashboardStats(true);

    expect(mockGetTransacoes).toHaveBeenCalledTimes(1);
  });
});
