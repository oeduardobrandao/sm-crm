import { describe, expect, it } from 'vitest';
import { LANDING } from '../landing.content';
import { LANDING_EN } from '../landing.content.en';
import { PRECOS } from '../precos.content';
import { PRECOS_EN } from '../precos.content.en';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('LANDING_EN parity with LANDING', () => {
  it('has the same structure counts', () => {
    expect(LANDING_EN.features).toHaveLength(LANDING.features.length);
    expect(LANDING_EN.ticker).toHaveLength(LANDING.ticker.length);
    expect(LANDING_EN.how.steps).toHaveLength(LANDING.how.steps.length);
    expect(LANDING_EN.faq).toHaveLength(LANDING.faq.length);
    expect(LANDING_EN.featureEyebrows).toHaveLength(LANDING.featureEyebrows.length);
    expect(LANDING_EN.metricTiles).toHaveLength(LANDING.metricTiles.length);
    expect(LANDING_EN.agente.bullets).toHaveLength(LANDING.agente.bullets.length);
    expect(LANDING_EN.nav.map((n) => n.id)).toEqual(LANDING.nav.map((n) => n.id));
    expect(LANDING_EN.footer.product).toHaveLength(LANDING.footer.product.length);
    expect(Object.keys(LANDING_EN.planMarketing)).toEqual(Object.keys(LANDING.planMarketing));
    expect(LANDING_EN.features.map((f) => !!f.showBullets)).toEqual(
      LANDING.features.map((f) => !!f.showBullets),
    );
  });

  it('pins the offer copy', () => {
    expect(LANDING_EN.hero.note).toBe(
      '14 days of Pro free, no card required. At the end, you decide whether to stay.',
    );
    expect(LANDING_EN.hero.note.startsWith(LANDING_EN.hero.noteStrong)).toBe(true);
    expect(LANDING.hero.note.startsWith(LANDING.hero.noteStrong)).toBe(true);
    expect(LANDING_EN.pricing.promo).toBe(
      'Create your account and use Pro for 14 days, no card required.',
    );
  });

  it('keeps the Portuguese landing copy as it shipped', () => {
    expect(LANDING.pricing.promo).toBe('Crie sua conta e use o Pro por 14 dias, sem cartão.');
    expect(LANDING.pricing.promoNote).toBe('14 dias de Pro grátis, sem cartão. Sem cupom.');
    expect(LANDING.planMarketing.pro).toEqual({
      description: 'Para freelancers com a carteira cheia.',
      cta: 'Começar teste grátis',
      highlight: true,
    });
  });

  it('has no em-dash and never claims Meta approval in English', () => {
    const all = [...strings(LANDING_EN), ...strings(PRECOS_EN)];
    expect(all.filter((s) => s.includes('—'))).toEqual([]);
    expect(all.filter((s) => /approved by meta|meta[- ]approved|meta partner/i.test(s))).toEqual(
      [],
    );
  });

  it('drops the Brazil-only billing copy in English', () => {
    const all = [...strings(LANDING_EN), ...strings(PRECOS_EN)].join('\n');
    expect(all).not.toMatch(/pagar\.?me|12x|\bR\$/i);
    expect(LANDING_EN.pricing.installments).toBeUndefined();
  });
});

describe('PRECOS_EN parity with PRECOS', () => {
  it('has the same structure counts', () => {
    expect(PRECOS_EN.plans).toHaveLength(PRECOS.plans.length);
    expect(PRECOS_EN.faq).toHaveLength(PRECOS.faq.length);
  });
});
