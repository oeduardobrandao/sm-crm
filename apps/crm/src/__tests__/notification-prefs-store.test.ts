import { describe, expect, it } from 'vitest';
import { EMAIL_NOTIFICATION_TYPES, mutedInappTypes } from '@/store/notificationPrefs';
import { NOTIFICATION_CATALOG } from '@/lib/notification-catalog';
import type { NotificationType } from '@/store/notifications';

describe('notificationPrefs', () => {
  it('deriva os 9 tipos de e-mail do catálogo, na ordem do catálogo', () => {
    const eligible = (Object.keys(NOTIFICATION_CATALOG) as NotificationType[]).filter(
      (t) => NOTIFICATION_CATALOG[t].emailEligible,
    );
    expect(EMAIL_NOTIFICATION_TYPES.map((e) => e.type)).toEqual(eligible);
    expect(EMAIL_NOTIFICATION_TYPES).toHaveLength(9);
  });
  it('usa o label e o "quando" do catálogo como copy', () => {
    for (const e of EMAIL_NOTIFICATION_TYPES) {
      expect(e.label).toBe(NOTIFICATION_CATALOG[e.type].label);
      expect(e.description).toBe(`Quando ${NOTIFICATION_CATALOG[e.type].when}.`);
    }
  });
  it('mutedInappTypes: __all__ false vence tudo', () => {
    expect(mutedInappTypes({ __all__: false, mention: true })).toBe('all');
  });
  it('mutedInappTypes lista só os desligados', () => {
    expect(mutedInappTypes({ mention: false, idea_submitted: true })).toEqual(['mention']);
  });
  it('mutedInappTypes ordena a lista (queryKeys estáveis) independente da ordem de entrada', () => {
    expect(mutedInappTypes({ mention: false, briefing_answered: false })).toEqual([
      'briefing_answered',
      'mention',
    ]);
  });
  it('mutedInappTypes vazio sem overrides', () => {
    expect(mutedInappTypes({})).toEqual([]);
  });
});
