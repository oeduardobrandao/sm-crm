import { describe, expect, it } from 'vitest';
import {
  EMAIL_NOTIFICATION_TYPES, mutedInappTypes,
} from '@/store/notificationPrefs';

describe('notificationPrefs', () => {
  it('tem 9 tipos de e-mail com post_approved por último', () => {
    expect(EMAIL_NOTIFICATION_TYPES).toHaveLength(9);
    expect(EMAIL_NOTIFICATION_TYPES.at(-1)?.type).toBe('post_approved');
  });
  it('mutedInappTypes: __all__ false vence tudo', () => {
    expect(mutedInappTypes({ __all__: false, mention: true })).toBe('all');
  });
  it('mutedInappTypes lista só os desligados', () => {
    expect(mutedInappTypes({ mention: false, idea_submitted: true })).toEqual(['mention']);
  });
  it('mutedInappTypes vazio sem overrides', () => {
    expect(mutedInappTypes({})).toEqual([]);
  });
});
