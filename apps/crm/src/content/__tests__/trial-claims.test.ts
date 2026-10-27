import { describe, expect, it } from 'vitest';
import { LANDING } from '../landing.content';
import { PRECOS } from '../precos.content';
import { PUBLIC_ROUTES } from '../site-meta';
import { APROVACAO_DE_POST } from '../paginas/aprovacao-de-post';
import { PORTAL_DO_CLIENTE } from '../paginas/portal-do-cliente';
import { AGENTE_DE_CONTEUDO_IA } from '../paginas/agente-de-conteudo-ia';

/**
 * Static surfaces (landing, /precos, marketing pages, meta) must match the real plans: the
 * trial is 30 days on the paid plans with a card, and only Free needs no card. They also state
 * no plan figure an Admin edit could change.
 */
describe('trial and plan claims on static surfaces', () => {
  const precosMeta = PUBLIC_ROUTES.find((route) => route.path === '/precos');
  const portalFaq = PORTAL_DO_CLIENTE.faq.find((item) => item.q.includes('identidade visual'));
  const perClientFaq = PRECOS.faq.find((item) => item.q.includes('cobrança por cliente'));
  const paymentFaq = PRECOS.faq.find((item) => item.q.includes('formas de pagamento'));

  it('landing copy', () => {
    expect(LANDING.hero.note).toBe('30 dias grátis em qualquer plano pago.');
    expect(LANDING.how.steps[0].description).toBe(
      'Comece o teste grátis de 30 dias, importe seus clientes por planilha e configure os modelos de contrato.',
    );
    const metrics = LANDING.features.find((feature) =>
      feature.description.includes('atualizados todo dia'),
    );
    expect(metrics?.description).toContain(
      'atualizados todo dia nos planos pagos, direto da API oficial.',
    );
  });

  it('/precos copy', () => {
    expect(PRECOS.sub).toBe(
      'Teste qualquer plano pago por 30 dias. O Free não pede cartão. Mude de plano quando quiser, sem fidelidade e sem multa de cancelamento.',
    );
    expect(perClientFaq?.a).toBe(
      'Não. Os planos do Mesaas são por workspace e se diferenciam pelo número de clientes e de usuários, sem cobrança extra por cliente atendido.',
    );
    expect(paymentFaq?.a).toBe(
      'Cartão de crédito, pela Stripe. O plano anual também pode ser pago em 12x no cartão, pela Pagar.me.',
    );
    expect(precosMeta?.description).toBe(
      'Compare os planos Free, Start, Pro e Max do Mesaas. Teste os planos pagos por 30 dias e evolua conforme sua agência cresce.',
    );
  });

  it('marketing page CTAs', () => {
    expect(APROVACAO_DE_POST.cta.sub).toBe(
      'Teste grátis por 30 dias e envie o primeiro link de aprovação em minutos.',
    );
    expect(PORTAL_DO_CLIENTE.cta.sub).toBe(
      'Teste grátis por 30 dias e gere o primeiro link de portal em minutos.',
    );
    // The agent (feature_mcp) is not on every plan, and never on Free: no "conta grátis", no
    // claim that all paid plans include it, no plan name.
    expect(AGENTE_DE_CONTEUDO_IA.cta.sub).toBe(
      'O agente está em um dos planos pagos. Teste esse plano grátis por 30 dias e conecte o Claude ao seu workspace.',
    );
    expect(portalFaq?.a).toContain(
      'A identidade visual da agência está disponível nos planos pagos.',
    );
  });

  it('never pairs "sem cartão" with the trial and has no em dashes in the changed copy', () => {
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
      expect(text).not.toMatch(/sem cartão/i);
      expect(text).not.toContain('—');
    }
  });
});
