export const PRECOS = {
  h1: 'Planos e preços do Mesaas',
  sub: 'Comece grátis, sem cartão de crédito. Mude de plano quando quiser — sem fidelidade e sem multa de cancelamento.',
  plans: [
    { name: 'Free', description: 'Para conhecer a plataforma.' },
    { name: 'Start', description: 'Para freelancers que estão começando.' },
    { name: 'Pro', description: 'Para freelancers com carteira consolidada.' },
    { name: 'Max', description: 'Para micro-agências e equipes completas.' },
  ],
  faq: [
    {
      q: 'Posso trocar de plano depois?',
      a: 'Sim, a qualquer momento. O upgrade vale na hora e o downgrade entra no próximo ciclo de cobrança — sem multa e sem burocracia.',
    },
    {
      q: 'Existe cobrança por cliente atendido?',
      a: 'Não. Diferente de ferramentas que cobram por cliente, os planos do Mesaas são por workspace, com limites claros de contas de Instagram e recursos.',
    },
    {
      q: 'Tem desconto no plano anual?',
      a: 'Sim. Assinando o plano anual você paga menos do que a soma de 12 mensalidades. O percentual exato aparece na tabela de preços acima.',
    },
    {
      q: 'Quais formas de pagamento são aceitas?',
      a: 'Cartão de crédito, processado pela Stripe. A nota e o recibo chegam no seu e-mail a cada cobrança.',
    },
  ],
} as const;
