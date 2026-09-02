import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS } from '@/lib/notification-catalog';
import { EMAIL_NOTIFICATION_TYPES } from '@/store/notificationPrefs';

describe('notification-catalog', () => {
  it('cobre exatamente os 22 tipos', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toHaveLength(22);
  });
  it('todo tipo elegível a e-mail está marcado emailEligible', () => {
    for (const t of EMAIL_NOTIFICATION_TYPES.map((e) => e.type)) {
      expect(NOTIFICATION_CATALOG[t].emailEligible).toBe(true);
    }
    const eligible = Object.values(NOTIFICATION_CATALOG).filter((e) => e.emailEligible);
    expect(eligible).toHaveLength(9);
  });
  it('toda categoria usada existe em ORDER e LABELS', () => {
    for (const e of Object.values(NOTIFICATION_CATALOG)) {
      expect(CATEGORY_ORDER).toContain(e.category);
      expect(CATEGORY_LABELS[e.category]).toBeTruthy();
    }
  });
  it('copy sem em-dash', () => {
    for (const e of Object.values(NOTIFICATION_CATALOG)) {
      expect(e.when).not.toMatch(/—/);
      expect(e.recipients).not.toMatch(/—/);
    }
  });
});
