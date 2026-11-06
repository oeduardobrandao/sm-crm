import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { PostStatusAutomation } from '../../../../store';
import {
  ACTION_OPTIONS,
  automationActionLabel,
  automationTriggerLabel,
  buildAutomationPayload,
  NOTIFY_TARGET_OPTIONS,
} from '../phone/statusModel';
import { SURFACE_OPTIONS, LOGO_STYLE_OPTIONS } from '../phone/hubBrandingParts';

const automation = (patch: Partial<PostStatusAutomation>) =>
  ({
    id: 'a1',
    trigger_status: null,
    trigger_custom_status_id: null,
    action_type: 'notify',
    config: { target: 'roles', roles: ['owner', 'admin'] },
    ativo: true,
    ...patch,
  }) as unknown as PostStatusAutomation;

describe('statusModel / hubBrandingParts labels follow the UI language', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('keeps the Portuguese labels', () => {
    expect(ACTION_OPTIONS.map((o) => o.label)).toEqual(['Notificar', 'Atribuir responsável']);
    expect(automationActionLabel(automation({}), [])).toBe('Notificar owners e admins');
    expect(SURFACE_OPTIONS.map((o) => o.label)).toEqual(['Neutro', 'Quente', 'Frio']);
  });

  it('switches to English without a reload', async () => {
    await i18n.changeLanguage('en');
    expect(ACTION_OPTIONS.map((o) => o.label)).toEqual(['Notify', 'Assign owner']);
    expect(NOTIFY_TARGET_OPTIONS.map((o) => o.label)).toEqual([
      'Post owner',
      'Owners and admins',
      'Specific member',
    ]);
    expect(
      automationActionLabel(
        automation({ action_type: 'assign_responsavel', config: { membro_id: 9 } }),
        [],
      ),
    ).toBe('Assign to removed member');
    expect(automationTriggerLabel(automation({ trigger_custom_status_id: 'gone' }), [])).toBe(
      'Removed status',
    );
    expect(
      buildAutomationPayload({
        trigger: 'canonical:rascunho',
        action: 'notify',
        notifyTarget: 'member',
        membroId: '',
      }),
    ).toEqual({ error: 'Choose a member' });
    expect(SURFACE_OPTIONS.map((o) => o.label)).toEqual(['Neutral', 'Warm', 'Cool']);
    expect(LOGO_STYLE_OPTIONS[0]).toMatchObject({ label: 'Round', sublabel: 'circular avatar' });
  });
});
