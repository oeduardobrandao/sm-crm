import { describe, expect, it } from 'vitest';
import { LANDING_EN } from '../landing.content.en';
import { PRECOS_EN } from '../precos.content.en';

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : [];

describe('trial claims on the English surfaces', () => {
  it('pins the reverse-trial promo', () => {
    expect(LANDING_EN.hero.note.startsWith('14 days of Pro free, no card required.')).toBe(true);
    expect(LANDING_EN.pricing.promo).toBe(
      'Create your account and use Pro for 14 days, no card required.',
    );
  });

  it('any 30-day trial claim says it needs a card', () => {
    const all = [...strings(LANDING_EN), ...strings(PRECOS_EN)];
    const claims = all.filter((s) => /30[- ]days?/i.test(s) && /trial|free/i.test(s));
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim).toMatch(/with a card/i);
  });

  it('English copy never mentions BRL, 12x or Pagar.me', () => {
    const all = [...strings(LANDING_EN), ...strings(PRECOS_EN)].join('\n');
    expect(all).not.toContain('R$');
    expect(all).not.toMatch(/12x|Pagar\.?me/i);
  });
});
