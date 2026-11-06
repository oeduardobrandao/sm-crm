export const PRECOS = {
  h1: 'Planos e preços do Mesaas',
  sub: 'Teste qualquer plano pago por 30 dias. O Free não pede cartão. Mude de plano quando quiser, sem fidelidade e sem multa de cancelamento.',
  plans: [
    { name: 'Free', description: 'Para conhecer a plataforma.' },
    { name: 'Start', description: 'Para freelancers montando a carteira.' },
    { name: 'Pro', description: 'Para freelancers com a carteira cheia.' },
    { name: 'Max', description: 'Para agências com equipe.' },
  ],
  faq: [
    {
      q: 'Posso trocar de plano depois?',
      a: 'Sim, a qualquer momento. O upgrade vale na hora e o downgrade entra no próximo ciclo de cobrança — sem multa e sem burocracia.',
    },
    {
      q: 'Existe cobrança por cliente atendido?',
      a: 'Não. Os planos do Mesaas são por workspace e se diferenciam pelo número de clientes e de usuários, sem cobrança extra por cliente atendido.',
    },
    {
      q: 'Tem desconto no plano anual?',
      a: 'Sim. Assinando o plano anual você paga menos do que a soma de 12 mensalidades. O percentual exato aparece na tabela de preços acima.',
    },
    {
      q: 'Quais formas de pagamento são aceitas?',
      a: 'Cartão de crédito, pela Stripe. O plano anual também pode ser pago em 12x no cartão, pela Pagar.me.',
    },
  ],
} as const;
