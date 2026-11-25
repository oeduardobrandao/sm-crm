import { describe, expect, it } from 'vitest';
import { LANDING } from '../landing.content';
import { PRECOS } from '../precos.content';
import { PUBLIC_ROUTES } from '../site-meta';
import { APROVACAO_DE_POST } from '../paginas/aprovacao-de-post';
import { PORTAL_DO_CLIENTE } from '../paginas/portal-do-cliente';
import { AGENTE_DE_CONTEUDO_IA } from '../paginas/agente-de-conteudo-ia';

/**
 * Static surfaces (landing, /precos, marketing pages, meta) must match the real offers: signing
 * up gives 14 days of Pro with no card (reverse trial, spec 2026-11-24), and picking a paid plan
 * at checkout gives 30 days with a card. Any 30-day claim says "com cartão". They also state no
 * plan figure an Admin edit could change. These ship only after reverse_trial_enabled is on.
 */
describe('trial and plan claims on static surfaces', () => {
  const precosMeta = PUBLIC_ROUTES.find((route) => route.path === '/precos');
  const portalFaq = PORTAL_DO_CLIENTE.faq.find((item) => item.q.includes('identidade visual'));
  const perClientFaq = PRECOS.faq.find((item) => item.q.includes('cobrança por cliente'));
  const paymentFaq = PRECOS.faq.find((item) => item.q.includes('formas de pagamento'));

  it('landing copy', () => {
    expect(LANDING.hero.note).toBe(
      '14 dias de Pro grátis, sem cartão. No fim, você escolhe se continua.',
    );
    expect(LANDING.how.steps[0].description).toBe(
      'Comece com 14 dias de Pro grátis, sem cartão, importe seus clientes por planilha e configure os modelos de contrato.',
    );
    const metrics = LANDING.features.find((feature) =>
      feature.description.includes('atualizados todo dia'),
    );
    expect(metrics?.description).toContain(
      'atualizados todo dia nos planos pagos, direto das APIs oficiais.',
    );
  });

  it('/precos copy', () => {
    expect(PRECOS.sub).toBe(
      '14 dias de Pro grátis, sem cartão. Prefere escolher o plano agora? Os planos pagos têm 30 dias grátis com cartão. Mude de plano quando quiser, sem fidelidade e sem multa de cancelamento.',
    );
    expect(perClientFaq?.a).toBe(
      'Não. Os planos do Mesaas são por workspace e se diferenciam pelo número de clientes e de usuários, sem cobrança extra por cliente atendido.',
    );
    expect(paymentFaq?.a).toBe(
      'Cartão de crédito, pela Stripe. O plano anual também pode ser pago em 12x no cartão, pela Pagar.me.',
    );
    expect(precosMeta?.description).toBe(
      'Compare os planos Free, Start, Pro e Max do Mesaas. Teste o Pro por 14 dias sem cartão e evolua conforme sua agência cresce.',
    );
  });

  it('marketing page CTAs', () => {
    expect(APROVACAO_DE_POST.cta.sub).toBe(
      'Teste o Pro grátis por 14 dias, sem cartão, e envie o primeiro link de aprovação em minutos.',
    );
    expect(PORTAL_DO_CLIENTE.cta.sub).toBe(
      'Teste o Pro grátis por 14 dias, sem cartão, e gere o primeiro link de portal em minutos.',
    );
    // The signup trial is Pro, which includes the agent (feature_mcp); no "conta grátis".
    expect(AGENTE_DE_CONTEUDO_IA.cta.sub).toBe(
      'Teste o Pro grátis por 14 dias, sem cartão, e conecte o Claude ao seu workspace.',
    );
    expect(portalFaq?.a).toContain(
      'A identidade visual da agência está disponível nos planos pagos.',
    );
  });

  it('says "com cartão" on every 30-day claim and has no em dashes in the changed copy', () => {
    const changed = [
      LANDING.hero.note,
      LANDING.how.steps[0].description,
      PRECOS.sub,
      perClientFaq?.a ?? '',
      paymentFaq?.a ?? '',
      precosMeta?.description ?? '',
      APROVACAO_DE_POST.cta.sub,
      PORTAL_DO_CLIENTE.cta.sub,
      AGENTE_DE_CONTEUDO_IA.cta.sub,
    ];
    for (const text of changed) {
      if (/30 dias grátis/.test(text)) expect(text).toMatch(/30 dias grátis com cartão/);
      if (/14 dias/.test(text)) expect(text).toMatch(/sem cartão/);
      expect(text).not.toMatch(/qualquer plano pago por 30 dias/i);
      expect(text).not.toContain('—');
    }
  });
});
