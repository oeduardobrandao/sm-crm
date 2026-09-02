import { describe, it, expect, vi, beforeEach } from 'vitest';

// See membership.test.ts for why vi.hoisted() is required here: the '../clients'
// import below pulls in '../core', which runs this factory before any plain
// top-level const in this file would be initialized.
const { mockSelect, mockSingle, mockEq, mockUpdate, mockFrom, mockGetUserId, mockGetContaId } =
  vi.hoisted(() => ({
    mockSelect: vi.fn(),
    mockSingle: vi.fn(),
    mockEq: vi.fn(),
    mockUpdate: vi.fn(),
    mockFrom: vi.fn(),
    mockGetUserId: vi.fn(),
    mockGetContaId: vi.fn(),
  }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getUserId: mockGetUserId,
  getContaId: mockGetContaId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

// updateCliente doesn't touch hub.ts, but clients.ts imports it at module
// scope (addCliente's auto-seed) — stub it so the import graph resolves.
vi.mock('../hub', () => ({ applyTemplateToClient: vi.fn() }));

import { updateCliente } from '../clients';

describe('CLIENTE_SAFE_COLUMNS — Pendências do Hub (Fase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContaId.mockResolvedValue('ws-1');
    mockSingle.mockResolvedValue({ data: {}, error: null });
    mockSelect.mockReset().mockReturnValue({ single: mockSingle });
    mockEq.mockReset().mockReturnValue({ select: mockSelect });
    mockUpdate.mockReset().mockReturnValue({ eq: mockEq });
    mockFrom.mockImplementation(() => ({ update: mockUpdate }));
  });

  it('appends send_event_email and event_email_unsub_at at the end of the allowlist', async () => {
    await updateCliente(1, { send_event_email: false });
    expect(mockSelect).toHaveBeenCalledTimes(1);
    const columns = mockSelect.mock.calls[0][0] as string;
    expect(columns.trim().endsWith('send_event_email, event_email_unsub_at')).toBe(true);
  });

  it('never exposes the cron cursor/lease columns (service-role-only)', async () => {
    await updateCliente(1, { send_event_email: false });
    const columns = mockSelect.mock.calls[0][0] as string;
    expect(columns).not.toMatch(/\bevent_cursor_at\b/);
    expect(columns).not.toMatch(/\bevent_claim_through\b/);
    expect(columns).not.toMatch(/\bevent_claimed_at\b/);
  });
});
