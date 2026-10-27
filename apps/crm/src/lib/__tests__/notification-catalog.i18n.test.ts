import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATALOG,
  catalogText,
  categoryLabel,
} from '@/lib/notification-catalog';
import type { NotificationType } from '@/store/notifications';

describe('notification-catalog i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('pt: helpers devolvem exatamente o texto das constantes', () => {
    for (const type of Object.keys(NOTIFICATION_CATALOG) as NotificationType[]) {
      const { label, when, recipients } = NOTIFICATION_CATALOG[type];
      expect(catalogText(type)).toEqual({ label, when, recipients });
    }
    for (const category of Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]) {
      expect(categoryLabel(category)).toBe(CATEGORY_LABELS[category]);
    }
  });

  it('en: categorias e linhas traduzidas', async () => {
    await i18n.changeLanguage('en');
    expect(categoryLabel('agenda')).toBe('Events');
    expect(categoryLabel('aprovacoes_hub')).toBe('Approvals and Hub');
    expect(catalogText('post_approved')).toEqual({
      label: 'Post approved by the client',
      when: 'the client approves a post in the Hub',
      recipients: 'person responsible + owners and admins',
    });
    expect(catalogText('task_assigned').label).toBe('Task assigned to you');
    expect(catalogText('event_reminder').recipients).toBe('Event participants');
  });

  it('en: nenhuma linha fica em português nem com em-dash', async () => {
    await i18n.changeLanguage('en');
    for (const type of Object.keys(NOTIFICATION_CATALOG) as NotificationType[]) {
      const en = catalogText(type);
      expect(en.when).not.toBe(NOTIFICATION_CATALOG[type].when);
      expect(en.label).not.toBe(NOTIFICATION_CATALOG[type].label);
      for (const v of Object.values(en)) expect(v).not.toMatch(/—|settings:|catalog\./);
    }
  });
});
