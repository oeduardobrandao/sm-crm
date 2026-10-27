import { describe, expect, test } from 'vitest';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

const meta = { cliente_nome: 'Dr. Rafael Lima', periodo: '2026-11-01', comentarios: 2 };

describe('linha editorial notifications', () => {
  test('aprovada names the client and the month, with the comment count', () => {
    const d = getNotificationDisplay('linha_editorial_aprovada', meta);
    expect(d.icon).toBe(CheckCircle);
    expect(d.tone).toBe('success');
    expect(d.title).toBe('Dr. Rafael Lima aprovou a linha editorial de novembro');
    expect(d.body).toBe('2 comentários');
  });

  test('aprovada body is singular for 1 and empty for 0 or missing', () => {
    expect(
      getNotificationDisplay('linha_editorial_aprovada', { ...meta, comentarios: 1 }).body,
    ).toBe('1 comentário');
    expect(
      getNotificationDisplay('linha_editorial_aprovada', { ...meta, comentarios: 0 }).body,
    ).toBe('');
    expect(
      getNotificationDisplay('linha_editorial_aprovada', {
        cliente_nome: 'A',
        periodo: '2026-11-01',
      }).body,
    ).toBe('');
  });

  test('ajustes names the client and the month', () => {
    const d = getNotificationDisplay('linha_editorial_ajustes', meta);
    expect(d.icon).toBe(AlertTriangle);
    expect(d.tone).toBe('warning');
    expect(d.title).toBe('Dr. Rafael Lima pediu ajustes na linha editorial de novembro');
    expect(d.body).toBe('2 comentários');
  });

  test('month is parsed without a timezone shift (first and last days)', () => {
    const first = getNotificationDisplay('linha_editorial_ajustes', {
      ...meta,
      periodo: '2026-01-01',
    });
    expect(first.title).toContain('de janeiro');
    const dec = getNotificationDisplay('linha_editorial_ajustes', {
      ...meta,
      periodo: '2026-12-01',
    });
    expect(dec.title).toContain('de dezembro');
    const marco = getNotificationDisplay('linha_editorial_ajustes', {
      ...meta,
      periodo: '2026-03-31',
    });
    expect(marco.title).toContain('de março');
  });

  test('falls back when the metadata is missing', () => {
    expect(getNotificationDisplay('linha_editorial_aprovada', {}).title).toBe(
      'Cliente aprovou a linha editorial',
    );
    expect(getNotificationDisplay('linha_editorial_ajustes', { periodo: 'x' }).title).toBe(
      'Cliente pediu ajustes na linha editorial',
    );
  });

  test('both are Aprovações e Hub entries and e-mail eligible', () => {
    for (const t of ['linha_editorial_aprovada', 'linha_editorial_ajustes'] as const) {
      expect(NOTIFICATION_CATALOG[t].category).toBe('aprovacoes_hub');
      expect(NOTIFICATION_CATALOG[t].emailEligible).toBe(true);
      expect(EMAIL_ELIGIBLE_TYPES).toContain(t);
    }
  });

  test('copy has no em dash', () => {
    for (const t of ['linha_editorial_aprovada', 'linha_editorial_ajustes'] as const) {
      const d = getNotificationDisplay(t, meta);
      const c = NOTIFICATION_CATALOG[t];
      expect(`${d.title}${d.body}${c.label}${c.when}`).not.toContain('—');
    }
  });
});
