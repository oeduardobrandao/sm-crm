import { describe, expect, it } from 'vitest';
import {
  buildEmailView,
  formatRate,
  presetRange,
  rates,
  typeLabel,
  validateCustomRange,
} from '../email-metrics-view';
import type { EmailMetricsResponse } from '../../../lib/api';

const z = { delivered: 0, bounced: 0, complained: 0, delayed: 0, pending: 0, not_sent: 0 };

describe('rates', () => {
  it('computes delivery, bounce and complaint', () => {
    const r = rates({ ...z, sent: 100, delivered: 95, complained: 1, bounced: 3 });
    expect(r.delivery).toBeCloseTo(0.96);
    expect(r.bounce).toBeCloseTo(0.03);
    expect(r.complaint).toBeCloseTo(1 / 96);
  });
  it('returns null on zero base', () => {
    expect(rates({ ...z, sent: 0 })).toEqual({ delivery: null, bounce: null, complaint: null });
    const r = rates({ ...z, sent: 5, bounced: 5 });
    expect(r.complaint).toBeNull();
  });
});

describe('formatRate', () => {
  it('formats pt-BR', () => {
    expect(formatRate(null)).toBe('Sem envios');
    expect(formatRate(0.0008)).toBe('0,08%');
    expect(formatRate(0.961)).toBe('96,1%');
  });
});

describe('typeLabel', () => {
  it('falls back to the raw value', () => {
    expect(typeLabel('xyz')).toBe('xyz');
    expect(typeLabel('nurture_a3_b1')).toBe('Nurture A3 ou B1');
    expect(typeLabel('alerta_interno')).toBe('Alerta interno');
  });
});

describe('buildEmailView', () => {
  const res: EmailMetricsResponse = {
    coverage_start: '2026-11-01T00:00:00Z',
    by_type: [
      { category: 'notificacoes', type: 'client_event', ...z, sent: 10, delivered: 9 },
      { category: 'notificacoes', type: 'notification_digest', ...z, sent: 30, delivered: 28 },
      { category: 'convites', type: 'invite', ...z, sent: 50, delivered: 40, bounced: 5 },
      { category: 'interno', type: 'cron_failure', ...z, sent: 99, delivered: 99 },
    ],
    daily: [],
    recent: [],
  };
  it('excludes internal categories from KPIs and sorts by sent', () => {
    const v = buildEmailView(res);
    expect(v.kpis.sent).toBe(90);
    expect(v.kpis.bounced).toBe(5);
    expect(v.categories.map((c) => c.category)).toEqual(['convites', 'notificacoes']);
    expect(v.categories[1].types.map((t) => t.type)).toEqual([
      'notification_digest',
      'client_event',
    ]);
    expect(v.excluded.map((c) => c.category)).toEqual(['interno']);
    expect(v.coverageStart).toBe('2026-11-01T00:00:00Z');
  });
});

describe('presetRange', () => {
  it('uses the Sao Paulo date', () => {
    expect(presetRange('7d', new Date('2026-11-09T02:00:00Z'))).toEqual({
      start: '2026-11-02',
      end: '2026-11-08',
    });
    expect(presetRange('30d', new Date('2026-11-09T15:00:00Z'))).toEqual({
      start: '2026-10-11',
      end: '2026-11-09',
    });
  });
});

describe('validateCustomRange', () => {
  it('enforces order and 365-day max', () => {
    expect(validateCustomRange('2026-01-01', '2026-01-31')).toBeNull();
    expect(validateCustomRange('2026-01-31', '2026-01-01')).not.toBeNull();
    expect(validateCustomRange('2025-11-06', '2026-11-06')).toBeNull();
    expect(validateCustomRange('2025-11-05', '2026-11-06')).not.toBeNull();
    expect(validateCustomRange('', '2026-01-01')).not.toBeNull();
  });
});
