import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

import {
  getHubPeople,
  addHubPerson,
  removeHubPerson,
  setHubRequireLogin,
  hubPeopleErrorCode,
  hubPeopleKey,
  HUB_PEOPLE_LIMIT,
} from '../hubPeople';

beforeEach(() => {
  mockRpc.mockReset();
});

describe('hubPeople store', () => {
  it('getHubPeople calls hub_people_list with p_cliente_id and returns the payload', async () => {
    const payload = {
      require_login: true,
      people: [
        {
          id: 'p1',
          nome: 'Marina Costa',
          email: 'marina@x.com',
          last_login_at: null,
          created_at: '2026-11-01T00:00:00Z',
        },
      ],
    };
    mockRpc.mockResolvedValue({ data: payload, error: null });
    await expect(getHubPeople(15)).resolves.toEqual(payload);
    expect(mockRpc).toHaveBeenCalledWith('hub_people_list', { p_cliente_id: 15 });
  });

  it('getHubPeople throws the rpc error', async () => {
    const err = { message: 'forbidden' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(getHubPeople(15)).rejects.toBe(err);
  });

  it('addHubPerson calls hub_people_add and returns the new id', async () => {
    mockRpc.mockResolvedValue({ data: 'new-id', error: null });
    await expect(addHubPerson(15, 'Marina Costa', 'marina@x.com')).resolves.toBe('new-id');
    expect(mockRpc).toHaveBeenCalledWith('hub_people_add', {
      p_cliente_id: 15,
      p_nome: 'Marina Costa',
      p_email: 'marina@x.com',
    });
  });

  it('addHubPerson throws the rpc error', async () => {
    const err = { message: 'duplicate' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(addHubPerson(15, 'a', 'b@c.d')).rejects.toBe(err);
  });

  it('removeHubPerson calls hub_people_remove with p_person_id', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await removeHubPerson('p1');
    expect(mockRpc).toHaveBeenCalledWith('hub_people_remove', { p_person_id: 'p1' });
  });

  it('removeHubPerson throws the rpc error', async () => {
    const err = { message: 'last_person' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(removeHubPerson('p1')).rejects.toBe(err);
  });

  it('setHubRequireLogin calls hub_set_require_login with p_cliente_id and p_value', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await setHubRequireLogin(15, true);
    expect(mockRpc).toHaveBeenCalledWith('hub_set_require_login', {
      p_cliente_id: 15,
      p_value: true,
    });
  });

  it('setHubRequireLogin throws the rpc error', async () => {
    const err = { message: 'no_people' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(setHubRequireLogin(15, true)).rejects.toBe(err);
  });

  it('exposes the query key and the limit', () => {
    expect(hubPeopleKey(15)).toEqual(['hub-people', 15]);
    expect(HUB_PEOPLE_LIMIT).toBe(20);
  });

  describe('hubPeopleErrorCode', () => {
    for (const code of [
      'forbidden',
      'not_found',
      'invalid',
      'duplicate',
      'limit',
      'no_people',
      'last_person',
    ]) {
      it(`maps ${code}`, () => {
        expect(hubPeopleErrorCode({ message: code })).toBe(code);
        expect(hubPeopleErrorCode({ message: `  ${code}\n` })).toBe(code);
      });
    }

    it('falls back to generic', () => {
      expect(hubPeopleErrorCode({ message: 'invalid input syntax for type uuid' })).toBe('generic');
      expect(hubPeopleErrorCode({ message: 'ERROR: limit (P0001)' })).toBe('generic');
      expect(hubPeopleErrorCode({ message: 'relation "x" does not exist' })).toBe('generic');
      expect(hubPeopleErrorCode({})).toBe('generic');
    });
  });
});
