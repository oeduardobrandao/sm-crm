import { describe, expect, it } from 'vitest';
import { authStateLabel, statusTags, canActOnInvite } from '../workspace-invites';
import type { InviteInfo, InviteAuthState } from '../../lib/api';

const auth = (o: Partial<InviteAuthState>): InviteAuthState => ({
  user_id: 'u1',
  email_confirmed: false,
  confirmation_sent_at: null,
  invited_at: null,
  last_sign_in_at: null,
  has_password: null,
  onboarding_complete: false,
  is_member: false,
  ...o,
});
const inv = (o: Partial<InviteInfo>): InviteInfo => ({
  id: 'i1',
  email: 'a@x.com',
  role: 'agent',
  status: 'pending',
  created_at: '2026-07-23T00:00:00Z',
  accepted_at: null,
  expires_at: null,
  invited_by: 'o1',
  silent_add: false,
  link_expired: false,
  auth_state: null,
  ...o,
});

describe('authStateLabel', () => {
  it('no account when there is no auth user', () => {
    expect(authStateLabel(null)).toBe('sem conta');
  });
  it('member of this workspace wins over everything', () => {
    expect(
      authStateLabel(auth({ is_member: true, has_password: true, onboarding_complete: true })),
    ).toBe('membro deste workspace');
  });
  it('onboarded when password + onboarding complete', () => {
    expect(authStateLabel(auth({ has_password: true, onboarding_complete: true }))).toBe(
      'onboarding concluído',
    );
  });
  it('confirmed, no password', () => {
    expect(authStateLabel(auth({ email_confirmed: true, has_password: false }))).toBe(
      'confirmado, sem senha',
    );
  });
  it('email sent, never opened requires a recorded send (finding 4)', () => {
    expect(authStateLabel(auth({ confirmation_sent_at: '2026-07-23T00:00:00Z' }))).toBe(
      'e-mail enviado, nunca aberto',
    );
  });
  it('account exists (no send recorded) when a user exists but no send is on file', () => {
    expect(authStateLabel(auth({ confirmation_sent_at: null }))).toBe(
      'conta existe (sem envio registrado)',
    );
  });
});

describe('statusTags', () => {
  it('adds a silent-add tag', () => {
    expect(statusTags(inv({ status: 'accepted', silent_add: true }))).toContain(
      'adicionado silenciosamente. Nenhum e-mail foi enviado',
    );
  });
  it('adds a link-expired tag', () => {
    expect(statusTags(inv({ status: 'pending', link_expired: true }))).toContain('link expirado');
  });
  it('a clean pending invite has no extra tags', () => {
    expect(statusTags(inv({ status: 'pending' }))).toEqual([]);
  });
});

describe('canActOnInvite', () => {
  it('allows actions on pending/expired only', () => {
    expect(canActOnInvite(inv({ status: 'pending' }))).toBe(true);
    expect(canActOnInvite(inv({ status: 'expired' }))).toBe(true);
    expect(canActOnInvite(inv({ status: 'accepted' }))).toBe(false);
  });
});
