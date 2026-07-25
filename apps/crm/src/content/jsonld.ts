import { SITE_NAME, SITE_URL, SOCIAL_PROFILES } from './site-meta';

const CONTEXT = 'https://schema.org';

export function organizationJsonLd(): object {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/mesaas-icon-192.png`,
    ...(SOCIAL_PROFILES.length ? { sameAs: SOCIAL_PROFILES } : {}),
  };
}

export function webSiteJsonLd(): object {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    inLanguage: 'pt-BR',
  };
}

export function softwareApplicationJsonLd(): object {
  return {
    '@context': CONTEXT,
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${SITE_URL}/`,
    description:
      'CRM para agências e gestores de social media: clientes, aprovações, agendamento no Instagram, relatórios e financeiro.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
      description: 'Plano Free — comece sem custo, sem cartão de crédito.',
    },
  };
}

export function faqPageJsonLd(items: Array<{ q: string; a: string }>): object {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  };
}

export function breadcrumbJsonLd(crumbs: Array<{ name: string; path: string }>): object {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.path === '/' ? `${SITE_URL}/` : `${SITE_URL}${c.path}`,
    })),
  };
}
