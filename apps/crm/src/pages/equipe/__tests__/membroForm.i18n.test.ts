import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { MEMBRO_FORM_DEFAULTS, membroSchema } from '../membroForm';
import { membroInviteErrorMessage } from '../inviteSupport';
import { tipoLabel } from '../phone/EquipePhone';

afterEach(() => i18n.changeLanguage('pt'));

const messages = () => {
  const r = membroSchema.safeParse({
    ...MEMBRO_FORM_DEFAULTS,
    diaPag: '40',
    inviteEnabled: true,
    inviteEmail: 'x',
  });
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('equipe helpers follow the UI language at call time', () => {
  it('pt', () => {
    expect(messages()).toEqual([
      'Nome obrigatório',
      'Cargo obrigatório',
      'Dia deve ser entre 1 e 31',
      'Email inválido',
    ]);
    expect(membroInviteErrorMessage('boom')).toBe(
      'Membro salvo, mas o convite falhou: erro desconhecido',
    );
    expect(tipoLabel('freelancer_mensal')).toBe('Freelancer Mensal');
  });

  it('en', async () => {
    await i18n.changeLanguage('en');
    expect(messages()).toEqual([
      'Name is required',
      'Role is required',
      'Day must be between 1 and 31',
      'Invalid email',
    ]);
    expect(membroInviteErrorMessage('boom')).toBe(
      'Member saved, but the invite failed: unknown error',
    );
    expect(tipoLabel('freelancer_mensal')).toBe('Monthly freelancer');
  });
});
