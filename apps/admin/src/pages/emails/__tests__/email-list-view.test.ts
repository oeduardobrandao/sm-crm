import { describe, expect, it } from 'vitest';
import {
  STATUS_GROUPS,
  formatSpDateTime,
  listFiltersToSearch,
  parseListSearch,
  resendEmailUrl,
  statusGroupOf,
} from '../email-list-view';

const TODAY = new Date('2026-11-07T15:00:00Z');
const sp = (q: string) => new URLSearchParams(q);

describe('statusGroupOf', () => {
  it('maps events to groups', () => {
    expect(statusGroupOf('suppressed')).toBe('nao_enviado');
    expect(statusGroupOf('failed')).toBe('nao_enviado');
    expect(statusGroupOf('canceled')).toBe('nao_enviado');
    expect(statusGroupOf('sent')).toBe('pendente');
    expect(statusGroupOf('delivery_delayed')).toBe('atrasado');
    expect(statusGroupOf('delivered')).toBe('entregue');
  });

  it('expands groups in the spec order', () => {
    expect(STATUS_GROUPS.map((g) => g.key)).toEqual([
      'entregue',
      'atrasado',
      'pendente',
      'bounce',
      'reclamacao',
      'nao_enviado',
    ]);
    expect(STATUS_GROUPS.find((g) => g.key === 'nao_enviado')?.events).toEqual([
      'failed',
      'suppressed',
      'canceled',
    ]);
  });
});

describe('parseListSearch', () => {
  it('defaults to 7d', () => {
    const f = parseListSearch(sp(''), TODAY);
    expect(f.preset).toBe('7d');
    expect(f.end).toBe('2026-11-07');
    expect(f.start).toBe('2026-11-01');
  });

  it('falls back to 7d on an invalid preset', () => {
    expect(parseListSearch(sp('preset=xyz'), TODAY).preset).toBe('7d');
  });

  it('falls back to 7d on an invalid custom date', () => {
    const f = parseListSearch(sp('preset=custom&start=2026-02-30&end=2026-03-01'), TODAY);
    expect(f.preset).toBe('7d');
  });

  it('keeps a valid custom range', () => {
    const f = parseListSearch(sp('preset=custom&start=2026-02-01&end=2026-03-01'), TODAY);
    expect(f).toMatchObject({ preset: 'custom', start: '2026-02-01', end: '2026-03-01' });
  });

  it('drops unknown categories, status keys and malformed types', () => {
    const f = parseListSearch(sp('cat=interno,foo&status=bounce,zzz&type=welcome,BAD!'), TODAY);
    expect(f.categories).toEqual(['interno']);
    expect(f.statuses).toEqual(['bounce']);
    expect(f.types).toEqual(['welcome']);
  });

  it('round-trips through listFiltersToSearch', () => {
    const f = parseListSearch(
      sp(
        'preset=custom&start=2026-02-01&end=2026-03-01&cat=interno,cobranca&type=welcome&status=bounce,entregue',
      ),
      TODAY,
    );
    expect(parseListSearch(listFiltersToSearch(f), TODAY)).toEqual(f);
    const g = parseListSearch(sp('preset=30d&cat=externo'), TODAY);
    expect(parseListSearch(listFiltersToSearch(g), TODAY)).toEqual(g);
  });
});

describe('helpers', () => {
  it('resendEmailUrl encodes the id', () => {
    expect(resendEmailUrl('a/b')).toBe('https://resend.com/emails/a%2Fb');
  });

  it('formatSpDateTime formats in Sao Paulo and never throws', () => {
    expect(formatSpDateTime('2026-11-01T12:00:00.123456+00:00')).toBe('01/11/2026 09:00');
    expect(formatSpDateTime('garbage')).toBe('');
  });
});
