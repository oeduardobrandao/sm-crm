import type { PrecosContent } from './precos.content';

export const PRECOS_EN: PrecosContent = {
  h1: 'Mesaas plans and pricing',
  sub: '14 days of Pro free, no card required. Prefer to pick a plan now? Paid plans include a 30-day free trial with a card. Switch plans whenever you like, with no lock-in and no cancellation fee.',
  plans: [
    { name: 'Free', description: 'To get to know the platform.' },
    { name: 'Start', description: 'For freelancers building their client list.' },
    { name: 'Pro', description: 'For freelancers with a full client list.' },
    { name: 'Max', description: 'For agencies with a team.' },
  ],
  faq: [
    {
      q: 'Can I change plans later?',
      a: 'Yes, at any time. An upgrade takes effect right away and a downgrade starts on your next billing cycle, with no fee and no paperwork.',
    },
    {
      q: 'Do you charge per client I manage?',
      a: 'No. Mesaas plans are per workspace and differ by the number of clients and users, with no extra charge per client you manage.',
    },
    {
      q: 'Is there a discount on the annual plan?',
      a: 'Yes. With the annual plan you pay less than the sum of 12 monthly payments. The exact percentage is shown in the pricing table above.',
    },
    {
      q: 'Which payment methods do you accept?',
      a: 'Credit cards, processed by Stripe. You are billed in US dollars.',
    },
  ],
};
