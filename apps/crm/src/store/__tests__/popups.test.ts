import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, getCurrentUserMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}));
vi.mock('../core', () => ({
  supabase: { from: fromMock },
  getCurrentUser: getCurrentUserMock,
}));

import { getActivePopups, getMyPopupInteractions, recordPopupInteraction } from '../popups';

function selectReturning(rows: unknown[]) {
  const chain = {
    select: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return chain;
}

const good = {
  id: 'p1',
  pages: [{ title: 'T', eyebrow: null, body: 'B', image_key: null }],
  cta_label: null,
  cta_url: null,
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: false,
  created_at: '2026-09-01T00:00:00Z',
};

describe('store/popups', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCurrentUserMock.mockResolvedValue({ id: 'u1' });
  });

  it('getActivePopups descarta pages que não é array não vazio', async () => {
    fromMock.mockReturnValue(
      selectReturning([good, { ...good, id: 'p2', pages: [] }, { ...good, id: 'p3', pages: 'x' }]),
    );
    const popups = await getActivePopups();
    expect(popups.map((p) => p.id)).toEqual(['p1']);
    expect(console.warn).toHaveBeenCalled();
  });

  it('getMyPopupInteractions devolve vazio sem usuário e filtra por user_id', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    expect(await getMyPopupInteractions()).toEqual([]);
    const chain = selectReturning([{ popup_id: 'p1', action: 'seen' }]);
    fromMock.mockReturnValue(chain);
    expect(await getMyPopupInteractions()).toEqual([{ popup_id: 'p1', action: 'seen' }]);
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('recordPopupInteraction insere com o user_id atual', async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    fromMock.mockReturnValue({ insert });
    await recordPopupInteraction('p1', 'cta');
    expect(fromMock).toHaveBeenCalledWith('popup_interactions');
    expect(insert).toHaveBeenCalledWith({ popup_id: 'p1', user_id: 'u1', action: 'cta' });
  });
});
