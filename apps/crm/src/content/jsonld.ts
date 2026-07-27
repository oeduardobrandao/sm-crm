import { SITE_NAME, SITE_URL, SOCIAL_PROFILES } from './site-meta';
import { BLOG_AUTHOR, postOgImage, postPath } from './blog';
import type { BlogPost } from './blog.schema';

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

function personAuthor(): object {
  return {
    '@type': 'Person',
    name: BLOG_AUTHOR.name,
    jobTitle: BLOG_AUTHOR.role,
    description: BLOG_AUTHOR.bio,
    url: BLOG_AUTHOR.url,
  };
}

function publisher(): object {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/mesaas-icon-192.png` },
  };
}

export function blogPostingJsonLd(post: BlogPost): object {
  const url = `${SITE_URL}${postPath(post)}`;
  return {
    '@context': CONTEXT,
    '@type': 'BlogPosting',
    headline: post.h1,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated,
    inLanguage: 'pt-BR',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: postOgImage(post.slug),
    author: personAuthor(),
    publisher: publisher(),
  };
}

export function blogIndexJsonLd(posts: BlogPost[]): object {
  return {
    '@context': CONTEXT,
    '@type': 'Blog',
    name: `Blog do ${SITE_NAME}`,
    url: `${SITE_URL}/blog`,
    inLanguage: 'pt-BR',
    publisher: publisher(),
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.h1,
      description: p.description,
      datePublished: p.date,
      url: `${SITE_URL}${postPath(p)}`,
    })),
  };
}
