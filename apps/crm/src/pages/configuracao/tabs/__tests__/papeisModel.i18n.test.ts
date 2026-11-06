import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { AGENT_ROLE_PRESET } from '@/lib/permissions';
import {
  memberCountLabel,
  moduleGroupLabel,
  moduleLabel,
  summarizePermissions,
} from '../phone/papeisModel';
import {
  inviteRoleLabel,
  inviteTimeLeftLabel,
  memberRoleLabel,
} from '../phone/membrosPhoneHelpers';

describe('papeisModel / membrosPhoneHelpers labels follow the UI language', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('keeps the Portuguese copy, including 0 membros', () => {
    expect(memberCountLabel(0)).toBe('0 membros');
    expect(memberCountLabel(1)).toBe('1 membro');
    expect(memberCountLabel(3)).toBe('3 membros');
    expect(moduleLabel('analytics')).toBe('Analytics e Relatórios');
    expect(moduleGroupLabel('gestao')).toBe('Gestão');
    expect(inviteRoleLabel('agent')).toBe('agente');
    expect(memberRoleLabel({ role: 'owner' })).toBe('Dono');
  });

  it('switches to English', async () => {
    await i18n.changeLanguage('en');
    expect(memberCountLabel(0)).toBe('0 members');
    expect(memberCountLabel(1)).toBe('1 member');
    expect(moduleLabel('clientes')).toBe('Clients');
    expect(moduleGroupLabel('trabalho')).toBe('Work');
    expect(summarizePermissions(AGENT_ROLE_PRESET)).not.toMatch(/editar|sem acesso/);
    expect(inviteRoleLabel('agent')).toBe('agent');
    expect(memberRoleLabel({ role: 'admin', papel_nome: 'Social' })).toBe('Social');
    const now = Date.parse('2026-04-20T12:00:00Z');
    expect(inviteTimeLeftLabel('2026-04-20T20:00:00Z', 'pending', now)).toBe('8h left');
  });
});
