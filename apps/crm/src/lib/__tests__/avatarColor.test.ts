import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { avatarColorClass, AVATAR_COLOR_COUNT } from '../avatarColor';

const css = readFileSync('apps/crm/style.css', 'utf8');

describe('avatarColorClass', () => {
  it('is deterministic for the same seed', () => {
    expect(avatarColorClass('Débora Kristin')).toBe(avatarColorClass('Débora Kristin'));
    expect(avatarColorClass(42)).toBe(avatarColorClass('42'));
  });

  it('only ever emits classes style.css defines, in both themes', () => {
    for (let i = 1; i <= AVATAR_COLOR_COUNT; i++) {
      expect(css).toContain(`.avatar--c${i} {`);
      expect(css).toContain(`[data-theme='dark'] .avatar--c${i} {`);
    }
    // The stylesheet must not define more slots than the helper can reach,
    // or some colours would silently never be assigned.
    const defined = css.match(/^\.avatar--c\d+ \{/gm) ?? [];
    expect(defined).toHaveLength(AVATAR_COLOR_COUNT);
  });

  it('stays in range for arbitrary seeds', () => {
    const seeds = ['', 'a', 'Ana', 'Mariana Torres de Carvalho', '   ', '🙂', 'x'.repeat(500)];
    for (const seed of seeds) {
      const cls = avatarColorClass(seed);
      const n = Number(cls.replace('avatar--c', ''));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(AVATAR_COLOR_COUNT);
    }
  });

  it('falls back to a valid class when the seed is missing', () => {
    for (const seed of [null, undefined]) {
      expect(avatarColorClass(seed)).toMatch(/^avatar--c[1-8]$/);
    }
  });

  it('spreads a realistic member list across more than one colour', () => {
    const names = [
      'Débora Kristin',
      'Jhuly Emilly',
      'Eduardo',
      'Mariana Torres de Carvalho',
      'Jadhy',
      'Izabel Cristina Lopes dos Santos',
      'Cintia',
    ];
    const used = new Set(names.map(avatarColorClass));
    expect(used.size).toBeGreaterThan(1);
  });
});
