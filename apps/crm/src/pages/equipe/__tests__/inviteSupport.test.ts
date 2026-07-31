import { describe, expect, it } from 'vitest';
import { computeSeatState, membroInviteErrorMessage } from '../inviteSupport';

describe('computeSeatState', () => {
  it('is loading while limits load, regardless of counts', () => {
    const s = computeSeatState({
      isLoading: true,
      isUnlimited: false,
      maxTeamMembers: undefined,
      membersCount: 3,
      pendingCount: 1,
    });
    expect(s.status).toBe('loading');
  });

  it('is unavailable when limits failed to load (never enabled-by-default)', () => {
    const s = computeSeatState({
      isLoading: false,
      isUnlimited: false,
      maxTeamMembers: undefined,
      membersCount: 3,
      pendingCount: 0,
    });
    expect(s.status).toBe('unavailable');
  });

  it('is unlimited via the isUnlimited flag', () => {
    const s = computeSeatState({
      isLoading: false,
      isUnlimited: true,
      maxTeamMembers: undefined,
      membersCount: 99,
      pendingCount: 5,
    });
    expect(s.status).toBe('unlimited');
    expect(s.limit).toBeNull();
  });

  it('is unlimited via an explicit max_team_members null', () => {
    const s = computeSeatState({
      isLoading: false,
      isUnlimited: false,
      maxTeamMembers: null,
      membersCount: 2,
      pendingCount: 0,
    });
    expect(s.status).toBe('unlimited');
  });

  it('counts members plus pending invites against the limit', () => {
    const s = computeSeatState({
      isLoading: false,
      isUnlimited: false,
      maxTeamMembers: 5,
      membersCount: 3,
      pendingCount: 1,
    });
    expect(s).toEqual({ status: 'ok', used: 4, limit: 5, remaining: 1 });
  });

  it('is full at zero remaining and clamps oversubscription to zero', () => {
    expect(
      computeSeatState({
        isLoading: false,
        isUnlimited: false,
        maxTeamMembers: 4,
        membersCount: 3,
        pendingCount: 1,
      }).status,
    ).toBe('full');
    expect(
      computeSeatState({
        isLoading: false,
        isUnlimited: false,
        maxTeamMembers: 2,
        membersCount: 3,
        pendingCount: 1,
      }).remaining,
    ).toBe(0);
  });
});

describe('membroInviteErrorMessage', () => {
  it('maps plan_limit_exceeded to the shared entitlement wording', () => {
    const err = Object.assign(new Error('plan_limit_exceeded'), {
      error: 'plan_limit_exceeded',
      resource: 'max_team_members',
    });
    expect(membroInviteErrorMessage(err)).toBe(
      'Membro salvo, mas o convite falhou: Você atingiu o limite de usuários do seu plano.',
    );
  });

  it('falls back to the error message for other failures', () => {
    expect(membroInviteErrorMessage(new Error('Este usuário já pertence a este workspace.'))).toBe(
      'Membro salvo, mas o convite falhou: Este usuário já pertence a este workspace.',
    );
  });

  it('never renders undefined for a non-Error', () => {
    expect(membroInviteErrorMessage('boom')).toBe(
      'Membro salvo, mas o convite falhou: erro desconhecido',
    );
  });
});
