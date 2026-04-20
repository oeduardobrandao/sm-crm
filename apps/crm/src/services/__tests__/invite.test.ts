import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import { __setCurrentSession } from '../../lib/__mocks__/supabase';
import { inviteUser, cancelInvite } from '../invite';

const fetchHarness = createFetchMock();

describe('invite service', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    __setCurrentSession({ access_token: 'owner-token', user: { id: 'user-1' } });
  });

  describe('inviteUser', () => {
    it('sends invite request with email and role for admin users', async () => {
      fetchHarness.queueResponse({
        json: { success: true, message: 'Convite enviado com sucesso!' },
      });

      const result = await inviteUser('novo@equipe.com', 'agent');

      expect(result).toEqual({ success: true, message: 'Convite enviado com sucesso!' });
      expect(fetchHarness.calls).toHaveLength(1);
      expect(fetchHarness.calls[0].init?.method).toBe('POST');
      expect(String(fetchHarness.calls[0].input)).toContain('invite-user');

      const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
      expect(body).toEqual({ email: 'novo@equipe.com', role: 'agent' });
    });

    it('sends Authorization header with session token', async () => {
      fetchHarness.queueResponse({ json: { success: true } });

      await inviteUser('colega@equipe.com', 'admin');

      const headers = fetchHarness.calls[0].init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer owner-token');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('owners can invite admins', async () => {
      fetchHarness.queueResponse({ json: { success: true, message: 'Convite enviado!' } });

      const result = await inviteUser('admin@equipe.com', 'admin');

      expect(result.success).toBe(true);
      const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
      expect(body.role).toBe('admin');
    });

    it('owners can invite agents', async () => {
      fetchHarness.queueResponse({ json: { success: true, message: 'Convite enviado!' } });

      const result = await inviteUser('agente@equipe.com', 'agent');

      expect(result.success).toBe(true);
      const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
      expect(body.role).toBe('agent');
    });

    it('throws when email is empty', async () => {
      await expect(inviteUser('', 'agent')).rejects.toThrow('Email é obrigatório');
      expect(fetchHarness.calls).toHaveLength(0);
    });

    it('throws when user is not authenticated', async () => {
      __setCurrentSession(null);

      await expect(inviteUser('test@equipe.com', 'agent')).rejects.toThrow('Not authenticated');
      expect(fetchHarness.calls).toHaveLength(0);
    });

    it('throws with server error message when backend rejects', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 403,
        json: { error: 'Agentes não podem convidar usuários' },
      });

      await expect(inviteUser('test@equipe.com', 'admin')).rejects.toThrow(
        'Agentes não podem convidar usuários',
      );
    });

    it('throws when admin tries to invite an owner (escalation prevention)', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 403,
        json: { error: 'Admins não podem convidar owners' },
      });

      await expect(inviteUser('boss@equipe.com', 'owner')).rejects.toThrow(
        'Admins não podem convidar owners',
      );
    });

    it('throws when invite already exists for email', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 400,
        json: { error: 'Já existe um convite pendente para este email' },
      });

      await expect(inviteUser('existing@equipe.com', 'agent')).rejects.toThrow(
        'Já existe um convite pendente para este email',
      );
    });
  });

  describe('cancelInvite', () => {
    it('sends DELETE request with invite id', async () => {
      fetchHarness.queueResponse({ json: { success: true } });

      const result = await cancelInvite(42);

      expect(result).toEqual({ success: true });
      expect(fetchHarness.calls).toHaveLength(1);
      expect(fetchHarness.calls[0].init?.method).toBe('DELETE');
      expect(String(fetchHarness.calls[0].input)).toContain('invite-user?id=42');
    });

    it('includes Authorization header', async () => {
      fetchHarness.queueResponse({ json: { success: true } });

      await cancelInvite(7);

      const headers = fetchHarness.calls[0].init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer owner-token');
    });

    it('throws when not authenticated', async () => {
      __setCurrentSession(null);

      await expect(cancelInvite(1)).rejects.toThrow('Not authenticated');
    });

    it('throws with server error when cancel fails', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 404,
        json: { error: 'Convite não encontrado' },
      });

      await expect(cancelInvite(999)).rejects.toThrow('Convite não encontrado');
    });
  });
});
