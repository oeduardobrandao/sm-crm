import { describe, expect, it } from 'vitest';
import { attentionUnits, highlightsFor, sortUnits, specialtyStatsFor } from '../gbpOverviewModel';
import { unit } from './fixtures';

const kinds = (units: Parameters<typeof highlightsFor>[0]) =>
  Object.fromEntries(highlightsFor(units).map((h) => [h.kind, h.unit.id]));

describe('highlightsFor', () => {
  it('Mais ações: the unit with the most actions', () => {
    const units = [
      unit('a', { actions: 10 }),
      unit('b', { actions: 30 }),
      unit('c', { actions: 5 }),
    ];
    expect(kinds(units).actions).toBe('b');
  });

  it('breaks ties by unit title in pt-BR order', () => {
    const units = [
      unit('a', { title: 'Zona Sul', actions: 30 }),
      unit('b', { title: 'Água Branca', actions: 30 }),
    ];
    expect(kinds(units).actions).toBe('b');
  });

  it('Maior crescimento: biggest % growth among units with a covered previous window of 50+', () => {
    const units = [
      // +200% but only 10 views before: never chosen.
      unit('small', { profileViews: 30, prevProfileViews: 10 }),
      unit('edge', { profileViews: 490, prevProfileViews: 49 }),
      unit('uncovered', { profileViews: 900, prevProfileViews: null }),
      unit('fifty', { profileViews: 75, prevProfileViews: 50 }),
      unit('big', { profileViews: 1200, prevProfileViews: 1000 }),
    ];
    const growth = highlightsFor(units).find((h) => h.kind === 'growth');
    expect(growth?.unit.id).toBe('fifty');
    expect(growth?.value).toBeCloseTo(0.5);
  });

  it('never picks a unit whose previous window had 49 views', () => {
    const units = [unit('edge', { profileViews: 490, prevProfileViews: 49 })];
    expect(kinds(units).growth).toBeUndefined();
  });

  it('Melhor nota: best rating among units with 10+ reviews', () => {
    const units = [
      unit('few', { avgRating: 5, reviewCount: 9 }),
      unit('ok', { avgRating: 4.6, reviewCount: 10 }),
      unit('low', { avgRating: 4.1, reviewCount: 300 }),
      unit('none', { avgRating: null, reviewCount: 50 }),
    ];
    expect(kinds(units).rating).toBe('ok');
  });

  it('Mais avaliações novas: the unit with the most new reviews, only when above zero', () => {
    const units = [
      unit('a', { newReviews: 2 }),
      unit('b', { newReviews: 7 }),
      unit('c', { newReviews: null }),
    ];
    expect(kinds(units).newReviews).toBe('b');
    const none = [unit('a', { newReviews: 0 }), unit('b', { newReviews: null })];
    expect(kinds(none).newReviews).toBeUndefined();
  });

  it('leaves out a highlight with no eligible unit', () => {
    const units = [
      unit('a', { actions: 0, prevProfileViews: null, reviewCount: 3, newReviews: 0 }),
    ];
    expect(highlightsFor(units)).toEqual([]);
  });

  it('returns the highlights in a fixed order', () => {
    expect(highlightsFor([unit('a')]).map((h) => h.kind)).toEqual([
      'actions',
      'growth',
      'rating',
      'newReviews',
    ]);
  });
});

describe('specialtyStatsFor', () => {
  it('groups by specialty, keeps groups of 2+ units, averages per unit and weights the rating', () => {
    const units = [
      unit('a', {
        especialidade: 'Odontologia',
        profileViews: 100,
        actions: 10,
        avgRating: 5,
        reviewCount: 30,
      }),
      unit('b', {
        especialidade: 'Odontologia',
        profileViews: 300,
        actions: 30,
        avgRating: 4,
        reviewCount: 10,
      }),
      unit('c', { especialidade: 'Dermatologia', profileViews: 999 }),
      unit('d', { especialidade: null, profileViews: 1 }),
      unit('e', { especialidade: null, profileViews: 1 }),
    ];
    const stats = specialtyStatsFor(units);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      specialty: 'Odontologia',
      count: 2,
      viewsPerUnit: 200,
      actionsPerUnit: 20,
    });
    // (5 × 30 + 4 × 10) / 40
    expect(stats[0].avgRating).toBeCloseTo(4.75);
  });

  it('rating is null when no unit of the group has a rating', () => {
    const units = [
      unit('a', { especialidade: 'X', avgRating: null, reviewCount: null }),
      unit('b', { especialidade: 'X', avgRating: null, reviewCount: 0 }),
    ];
    expect(specialtyStatsFor(units)[0].avgRating).toBeNull();
  });
});

describe('attentionUnits', () => {
  it('lists revoked units first, then active stale ones, and nothing else', () => {
    const units = [
      unit('fresh'),
      unit('stale', { stale: true }),
      unit('revoked', { status: 'revoked' }),
    ];
    expect(attentionUnits(units).map((u) => u.id)).toEqual(['revoked', 'stale']);
  });
});

describe('sortUnits', () => {
  const units = [
    unit('a', { title: 'B', profileViews: 10, avgRating: null }),
    unit('b', { title: 'A', profileViews: 30, avgRating: 4 }),
    unit('c', { title: 'C', profileViews: 20, avgRating: 5 }),
  ];

  it('sorts numbers both ways', () => {
    expect(sortUnits(units, 'profileViews', 'desc').map((u) => u.id)).toEqual(['b', 'c', 'a']);
    expect(sortUnits(units, 'profileViews', 'asc').map((u) => u.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps nulls last in both directions', () => {
    expect(sortUnits(units, 'avgRating', 'desc').map((u) => u.id)).toEqual(['c', 'b', 'a']);
    expect(sortUnits(units, 'avgRating', 'asc').map((u) => u.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by title', () => {
    expect(sortUnits(units, 'title', 'asc').map((u) => u.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts an untitled unit by the label its cell shows', () => {
    const list = [
      unit('a', { title: 'Zona Sul', clientName: 'Ana' }),
      unit('b', { title: null, clientName: 'Aaron' }),
      unit('c', { title: '', clientName: 'Abel' }),
      unit('d', { title: 'Centro' }),
    ];
    const ids = sortUnits(list, 'title', 'asc', 'Unidade sem nome').map((u) => u.id);
    expect(ids).toEqual(['d', 'b', 'c', 'a']);
  });

  it('sorts an unparseable sync time last, like a missing one', () => {
    const list = [
      unit('bad', { lastSyncedAt: 'not-a-date' }),
      unit('old', { lastSyncedAt: '2026-10-01T00:00:00.000Z' }),
      unit('none', { lastSyncedAt: null }),
      unit('new', { lastSyncedAt: '2026-10-30T00:00:00.000Z' }),
    ];
    expect(
      sortUnits(list, 'lastSyncedAt', 'desc')
        .map((u) => u.id)
        .slice(0, 2),
    ).toEqual(['new', 'old']);
    expect(
      sortUnits(list, 'lastSyncedAt', 'asc')
        .map((u) => u.id)
        .slice(0, 2),
    ).toEqual(['old', 'new']);
  });

  it('does not mutate its input', () => {
    const before = units.map((u) => u.id);
    sortUnits(units, 'profileViews', 'asc');
    expect(units.map((u) => u.id)).toEqual(before);
  });
});
