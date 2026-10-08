import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS } from '@/lib/notification-catalog';
import { EMAIL_NOTIFICATION_TYPES } from '@/store/notificationPrefs';

describe('notification-catalog', () => {
  it('cobre exatamente os 31 tipos', () => {
    expect(Object.keys(NOTIFICATION_CATALOG)).toHaveLength(31);
  });
  it('todo tipo elegível a e-mail está marcado emailEligible', () => {
    for (const t of EMAIL_NOTIFICATION_TYPES.map((e) => e.type)) {
      expect(NOTIFICATION_CATALOG[t].emailEligible).toBe(true);
    }
    const eligible = Object.values(NOTIFICATION_CATALOG).filter((e) => e.emailEligible);
    expect(eligible).toHaveLength(16);
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
  it('os 8 tipos de agenda ficam na categoria agenda, com copy final', () => {
    expect(CATEGORY_LABELS.agenda).toBe('Agenda');
    // `when` e um fragmento: a UI prefixa "Quando: " (e a descricao de e-mail "Quando ... .").
    const expected = {
      event_invited: ['Convites para eventos', 'alguém adiciona você a um evento'],
      event_updated: [
        'Eventos alterados',
        'muda o horário, o local ou a repetição de um evento seu',
      ],
      event_cancelled: ['Eventos cancelados', 'um evento seu é cancelado ou você é removido dele'],
      event_rsvp: [
        'Respostas aos seus convites',
        'um participante responde a um evento que você organizou',
      ],
      event_reminder: ['Lembretes de eventos', 'no horário dos lembretes que você definiu'],
      event_client_rsvp: [
        'Cliente respondeu a um evento',
        'o cliente confirma ou recusa um evento compartilhado com ele',
      ],
      event_guest_rsvp: [
        'Convidado externo respondeu a um evento',
        'um convidado externo confirma ou recusa um evento seu',
      ],
      event_reschedule_requested: [
        'Cliente pediu para remarcar',
        'o cliente pede para remarcar um evento compartilhado com ele',
      ],
    } as const;
    for (const [type, [label, when]] of Object.entries(expected)) {
      const e = NOTIFICATION_CATALOG[type as keyof typeof expected];
      expect(e.category).toBe('agenda');
      expect(e.label).toBe(label);
      expect(e.when).toBe(when);
      const recipients =
        type === 'event_rsvp'
          ? 'Organizador do evento'
          : type === 'event_client_rsvp' ||
              type === 'event_guest_rsvp' ||
              type === 'event_reschedule_requested'
            ? 'Organizador do evento (ou donos e admins)'
            : 'Participantes do evento';
      expect(e.recipients).toBe(recipients);
    }
  });
  it('event_rsvp nao e elegivel a e-mail; os outros sete sao', () => {
    expect(NOTIFICATION_CATALOG.event_rsvp.emailEligible).toBe(false);
    expect(NOTIFICATION_CATALOG.event_invited.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_updated.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_cancelled.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_reminder.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_client_rsvp.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_guest_rsvp.emailEligible).toBe(true);
    expect(NOTIFICATION_CATALOG.event_reschedule_requested.emailEligible).toBe(true);
  });
});
