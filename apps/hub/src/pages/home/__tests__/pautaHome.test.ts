import { describe, expect, it } from 'vitest';
import {
  formatEyebrowDate,
  greetingKey,
  numberSections,
  pad2,
  startOfNextMonday,
  weekCount,
} from '../pautaHome';

describe('greetingKey', () => {
  it.each([
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
    [0, 'evening'],
    [4, 'evening'],
  ])('%i h → %s', (h, k) => expect(greetingKey(h)).toBe(k));
});

describe('formatEyebrowDate', () => {
  const thu = new Date(2026, 9, 8, 9, 0); // Thursday, local time
  it('pt drops "-feira" and capitalizes', () =>
    expect(formatEyebrowDate(thu, 'pt')).toBe('Quinta, 8 de outubro'));
  it('en', () => expect(formatEyebrowDate(thu, 'en')).toBe('Thursday, October 8'));
  it('pt keeps sábado/domingo whole', () =>
    expect(formatEyebrowDate(new Date(2026, 9, 10), 'pt')).toBe('Sábado, 10 de outubro'));
});

describe('week window', () => {
  it('next Monday 00:00 from a Thursday', () => {
    expect(startOfNextMonday(new Date(2026, 9, 8, 15, 0))).toEqual(
      new Date(2026, 9, 12, 0, 0, 0, 0),
    );
  });
  it('a Monday counts until the following Monday', () => {
    expect(startOfNextMonday(new Date(2026, 9, 12, 8, 0))).toEqual(new Date(2026, 9, 19));
  });
  it('a Sunday ends at midnight', () => {
    expect(startOfNextMonday(new Date(2026, 9, 11, 22, 0))).toEqual(new Date(2026, 9, 12));
  });
  it('counts agendado + aprovado_cliente in [now, next Monday)', () => {
    const now = new Date(2026, 9, 11, 22, 0); // Sunday 22:00
    const at = (d: Date) => d.toISOString();
    const posts = [
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 11, 23, 0)) }, // in
      { status: 'aprovado_cliente', scheduled_at: at(new Date(2026, 9, 11, 23, 59)) }, // in
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 12, 0, 0)) }, // Monday 00:00, out
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 11, 21, 0)) }, // past, out
      { status: 'enviado_cliente', scheduled_at: at(new Date(2026, 9, 11, 23, 0)) }, // wrong status
      { status: 'agendado', scheduled_at: null },
    ];
    expect(weekCount(posts, now)).toBe(2);
  });
});

describe('numberSections', () => {
  it('all present', () =>
    expect(numberSections(true, true)).toEqual({
      approvals: 1,
      calendar: 2,
      agenda: 3,
      resources: 4,
      results: 5,
    }));
  it('no pending, no agenda', () =>
    expect(numberSections(false, false)).toEqual({
      approvals: null,
      calendar: 1,
      agenda: null,
      resources: 2,
      results: 3,
    }));
  it('pad2', () => expect(pad2(3)).toBe('03'));
});
