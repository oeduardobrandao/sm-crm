# SEO/GEO Foundation Implementation Plan (rev. 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public Mesaas page indexable by Google and citable by AI crawlers — unique per-route meta, prerendered HTML (including the three legal pages), JSON-LD, sitemap, llms.txt, real HTTP 404s and noindex on private areas — plus a dedicated `/precos` page and the first three bottom-funnel feature pages targeting the keyword gaps found in the competitor analysis.

**Architecture:** Extend the existing changelog "SEO mirror" pattern (`scripts/changelog/prerender.ts` + `changelog.seo.ts`): page copy lives in typed content modules under `apps/crm/src/content/`, consumed by BOTH the React pages and static `.seo.ts` renderers. The three legal pages are pure JSX (zero imports, zero hooks — verified), so they are prerendered directly with `react-dom/server`'s `renderToStaticMarkup` instead of hand-written mirrors. A single post-build script (`scripts/seo/prerender.tsx`) injects per-route head tags + semantic HTML into copies of the built SPA shell, writing one `dist/<route>.html` per public route, plus `dist/app.html` (noindex SPA shell for authenticated routes), `dist/404.html` (real 404), `sitemap.xml` and `llms.txt`. The Vercel catch-all is replaced by an **enumerated** app-route rewrite so unknown URLs fall through to a genuine HTTP 404. No SSR server, no new dependencies.

**Tech Stack:** React 19 + React Router v7 (existing), `react-dom/server` at build time only, tsx build scripts (existing), Vitest, Playwright (existing devDep, for the OG image only).

## Context (from the two audits — 2026-07-24)

- `site:mesaas.com.br` returns nothing. The SPA serves the same `<title>Mesaas - Gestão Inteligente</title>` / "gerenciamento corporativo" description for every route; only `/novidades` is prerendered.
- **`/precos` does not exist as a route** — the `*` catch-all in `App.tsx` redirects unknown URLs to `/login`. The audit graded a page that soft-redirects to login.
- Audit fixes required: title 50–60 chars, description 120–160, OG/Twitter tags, Organization/WebSite/FAQPage JSON-LD, llms.txt, content in raw HTML, About/Contact page, heading hierarchy (h4 in "how" steps, h5 in footer), blog/volume (future phase).
- Competitor gaps to attack first (analysis §4): "aprovação de post" (abandoned SERP), "portal do cliente para agência", and the AI/MCP agent territory nobody occupies.
- **Indexing-control strategy** (per Google docs): robots.txt `Disallow` does NOT deindex — a blocked URL can still be indexed, and a blocked crawler can't see `noindex`. Therefore: private areas stay **crawlable** but carry `noindex` (meta tag in `app.html` + `X-Robots-Tag` headers in vercel.json); robots.txt only declares the sitemap.

## Global Constraints

- All user-facing copy is **pt-BR**; code, comments and commits are English (PRODUCT.md).
- Canonical origin is `https://www.mesaas.com.br` (matches prod `APP_BASE_URL`). Every canonical/og:url/sitemap URL uses it.
- Route titles must be **50–60 chars**, descriptions **120–160 chars** (the audit's ideal ranges) — enforced by tests in Task 1. Every string in this plan has been counted and fits.
- **No new npm dependencies** (`react-dom` is already a dependency; `renderToStaticMarkup` runs at build time only).
- Every module reachable from `scripts/seo/prerender.tsx` — the content modules, `usePageMeta`, and the three legal pages — must use **relative imports only** (no `@/` alias): the tsx script runner and `tsconfig.scripts.json` do not resolve the alias. Precedent: the changelog modules already do this.
- Landing copy is moved **byte-identical**; the only intentional visual changes on the landing are the new footer links (Task 5) and heading-tag swaps that keep identical styling. Existing tests in `apps/crm/src/pages/landing/__tests__/` must stay green.
- **Do not market features that don't exist in this repo**: there is no `generate_image` MCP tool (removed with Estúdio, PR #241); the MCP server offers `create_media_upload` + `set_post_media` (see `supabase/functions/mcp/tools.ts:246-262`). Agent-page copy reflects that.
- `SOCIAL_PROFILES` is a **placeholder to confirm with the user** (see Task 18 checklist); build must not depend on it. Contact e-mails `contato@mesaas.com.br` / `privacidade@mesaas.com.br` already appear in the repo's legal pages and are reused.
- CI gates: `npm run lint`, `npm run format:check`, `npm run test`, `npm run build`, **`npx tsc -p tsconfig.scripts.json`** (CI runs this — `.github/workflows/ci.yml` "Typecheck scripts") must pass before pushing.
- Path alias `@/` = `apps/crm/src/`. Tests colocated in `__tests__/` dirs (repo convention).

---

### Task 1: Route metadata manifest (`site-meta.ts`)

**Files:**
- Create: `apps/crm/src/content/site-meta.ts`
- Test: `apps/crm/src/content/__tests__/site-meta.test.ts`

**Interfaces:**
- Produces: `SITE_URL: string`, `SITE_NAME: string`, `DEFAULT_OG_IMAGE: string`, `SOCIAL_PROFILES: string[]`, `APP_ROUTE_PREFIXES: readonly string[]`, `interface RouteMeta { path: string; file?: string; title: string; description: string; lastmod: string; ogImage?: string }`, `PUBLIC_ROUTES: RouteMeta[]`, `routeMetaFor(path: string): RouteMeta | undefined`. Every later task consumes these.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/content/__tests__/site-meta.test.ts
import { describe, expect, test } from 'vitest';
import { APP_ROUTE_PREFIXES, PUBLIC_ROUTES, routeMetaFor, SITE_URL } from '../site-meta';

describe('site-meta', () => {
  test('canonical origin is www', () => {
    expect(SITE_URL).toBe('https://www.mesaas.com.br');
  });

  test('routes are unique by path and title', () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    const titles = PUBLIC_ROUTES.map((r) => r.title);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('every public route is prerendered', () => {
    for (const r of PUBLIC_ROUTES) expect(r.file, `${r.path} must have a file`).toBeTruthy();
  });

  test.each(PUBLIC_ROUTES.map((r) => [r.path, r] as const))(
    '%s meta respects the audit SERP ranges',
    (_path, r) => {
      expect(r.title.length).toBeGreaterThanOrEqual(50);
      expect(r.title.length).toBeLessThanOrEqual(60);
      expect(r.description.length).toBeGreaterThanOrEqual(120);
      expect(r.description.length).toBeLessThanOrEqual(160);
      expect(r.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.file).toMatch(/\.html$/);
    },
  );

  test('routeMetaFor resolves and misses correctly', () => {
    expect(routeMetaFor('/precos')?.file).toBe('precos.html');
    expect(routeMetaFor('/')?.file).toBe('index.html');
    expect(routeMetaFor('/dashboard')).toBeUndefined();
  });

  test('app-route prefixes do not collide with public routes', () => {
    for (const prefix of APP_ROUTE_PREFIXES) {
      expect(PUBLIC_ROUTES.some((r) => r.path === `/${prefix}`)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/site-meta.test.ts`
Expected: FAIL — `Cannot find module '../site-meta'`

- [ ] **Step 3: Write the implementation**

All title/description strings below were length-checked against 50–60 / 120–160.

```ts
// apps/crm/src/content/site-meta.ts
/** Single source of truth for public-route SEO metadata. Consumed by the
 * usePageMeta hook (client), the prerender script (build), the sitemap and
 * llms.txt builders. Update `lastmod` whenever a page's content changes. */

export const SITE_URL = 'https://www.mesaas.com.br';
export const SITE_NAME = 'Mesaas';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Real brand profiles (Instagram, LinkedIn…). Filled in by the user — see
 * docs/seo-checklist.md. JSON-LD omits sameAs while this is empty. */
export const SOCIAL_PROFILES: string[] = [];

/** Top-level SPA-only route prefixes served by app.html (noindex). Adding a
 * new top-level route in App.tsx? Add its prefix here AND to the app-shell
 * rewrite + X-Robots-Tag header in vercel.json — the guard test in
 * vercel-routing.test.ts enforces the rewrite half. Longer prefixes that
 * share a stem (analytics-fluxos vs analytics) must come first. */
export const APP_ROUTE_PREFIXES = [
  'login',
  'configurar-senha',
  'workspace-setup',
  'oauth',
  'dashboard',
  'clientes',
  'financeiro',
  'contratos',
  'leads',
  'equipe',
  'configuracao',
  'calendario',
  'entregas',
  'post-express',
  'arquivos',
  'analytics-fluxos',
  'analytics',
  'ideias',
  'ajuda',
] as const;

export interface RouteMeta {
  /** Route path, e.g. '/precos'. */
  path: string;
  /** Prerender output filename under dist/. */
  file?: string;
  /** 50–60 chars (audit SERP range). */
  title: string;
  /** 120–160 chars (audit SERP range). */
  description: string;
  /** YYYY-MM-DD, bumped when the page content changes. */
  lastmod: string;
  ogImage?: string;
}

export const PUBLIC_ROUTES: RouteMeta[] = [
  {
    path: '/',
    file: 'index.html',
    title: 'Mesaas — CRM para agências e gestores de social media',
    description:
      'CRM para social media: clientes, aprovação de posts por link, agendamento automático no Instagram, relatórios e financeiro em um só lugar. Comece grátis.',
    lastmod: '2026-07-24',
  },
  {
    path: '/precos',
    file: 'precos.html',
    title: 'Preços do Mesaas — planos para agências de social media',
    description:
      'Compare os planos Free, Start, Pro e Max do Mesaas. Comece grátis, sem cartão de crédito, e evolua conforme sua agência cresce. Cancele quando quiser.',
    lastmod: '2026-07-24',
  },
  {
    path: '/aprovacao-de-post',
    file: 'aprovacao-de-post.html',
    title: 'Aprovação de post por link, sem login do cliente | Mesaas',
    description:
      'Sistema de aprovação de posts para agências: o cliente recebe um link, revisa, comenta e aprova sem criar conta. Aprovou, o post já sai agendado no Instagram.',
    lastmod: '2026-07-24',
  },
  {
    path: '/portal-do-cliente',
    file: 'portal-do-cliente.html',
    title: 'Portal do cliente para agências de social media | Mesaas',
    description:
      'Um hub com a marca da sua agência onde o cliente aprova posts, acompanha o calendário, responde briefing e envia ideias — por link, sem senha e sem app.',
    lastmod: '2026-07-24',
  },
  {
    path: '/agente-de-conteudo-ia',
    file: 'agente-de-conteudo-ia.html',
    title: 'Agente de conteúdo com IA no fluxo da agência | Mesaas',
    description:
      'Conecte o Claude ao Mesaas via MCP: o agente lê briefing e estratégia, escreve com a voz de cada cliente e entrega o post no seu fluxo de aprovação.',
    lastmod: '2026-07-24',
  },
  {
    path: '/sobre',
    file: 'sobre.html',
    title: 'Sobre o Mesaas — quem constrói o CRM para social media',
    description:
      'O Mesaas nasceu dentro de uma agência para acabar com o caos de planilhas e grupos de WhatsApp. Conheça o produto, a proposta e como falar com a gente.',
    lastmod: '2026-07-24',
  },
  {
    path: '/novidades',
    file: 'novidades.html',
    title: 'Novidades do Mesaas — melhorias e recursos toda semana',
    description:
      'Acompanhe as novidades do Mesaas: melhorias no agendamento do Instagram, no portal de aprovação do cliente, nos relatórios e muito mais — toda semana.',
    lastmod: '2026-07-24',
  },
  {
    path: '/politica-de-privacidade',
    file: 'politica-de-privacidade.html',
    title: 'Política de Privacidade do Mesaas — CRM para social media',
    description:
      'Como o Mesaas coleta, usa e protege os dados da sua agência e dos seus clientes. Política de privacidade completa, em conformidade com a LGPD.',
    lastmod: '2026-07-24',
  },
  {
    path: '/termos-de-uso',
    file: 'termos-de-uso.html',
    title: 'Termos de Uso do Mesaas — CRM para social media no Brasil',
    description:
      'Condições de uso da plataforma Mesaas: contas, planos, pagamentos, responsabilidades e cancelamento. Leia os termos completos do serviço.',
    lastmod: '2026-07-24',
  },
  {
    path: '/lgpd',
    file: 'lgpd.html',
    title: 'LGPD no Mesaas — proteção de dados no CRM de social media',
    description:
      'Como o Mesaas atende à Lei Geral de Proteção de Dados: bases legais, direitos dos titulares, segurança da informação e canal de contato do DPO.',
    lastmod: '2026-07-24',
  },
];

export function routeMetaFor(path: string): RouteMeta | undefined {
  return PUBLIC_ROUTES.find((r) => r.path === path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/site-meta.test.ts`
Expected: PASS. If a length assertion fails, adjust the offending title/description wording (keep the keyword targets) until in range.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/site-meta.ts apps/crm/src/content/__tests__/site-meta.test.ts
git commit -m "feat(seo): add public-route metadata manifest"
```

---

### Task 2: JSON-LD builders (`jsonld.ts`)

**Files:**
- Create: `apps/crm/src/content/jsonld.ts`
- Test: `apps/crm/src/content/__tests__/jsonld.test.ts`

**Interfaces:**
- Consumes: `SITE_URL`, `SITE_NAME`, `SOCIAL_PROFILES` from Task 1.
- Produces: `organizationJsonLd(): object`, `webSiteJsonLd(): object`, `softwareApplicationJsonLd(): object`, `faqPageJsonLd(items: Array<{ q: string; a: string }>): object`, `breadcrumbJsonLd(crumbs: Array<{ name: string; path: string }>): object`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/content/__tests__/jsonld.test.ts
import { describe, expect, test } from 'vitest';
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from '../jsonld';

describe('jsonld builders', () => {
  test('Organization has name, url, logo; omits empty sameAs', () => {
    const org = organizationJsonLd() as Record<string, unknown>;
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('Mesaas');
    expect(org.url).toBe('https://www.mesaas.com.br/');
    expect(org.logo).toContain('https://www.mesaas.com.br/');
    expect('sameAs' in org).toBe(false);
  });

  test('WebSite is pt-BR', () => {
    const site = webSiteJsonLd() as Record<string, unknown>;
    expect(site['@type']).toBe('WebSite');
    expect(site.inLanguage).toBe('pt-BR');
  });

  test('SoftwareApplication offers a free BRL tier', () => {
    const app = softwareApplicationJsonLd() as { offers: Record<string, unknown> };
    expect(app.offers.priceCurrency).toBe('BRL');
    expect(app.offers.price).toBe('0');
  });

  test('FAQPage maps q/a to Question/Answer', () => {
    const faq = faqPageJsonLd([{ q: 'Pergunta?', a: 'Resposta.' }]) as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(faq.mainEntity[0].name).toBe('Pergunta?');
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('Resposta.');
  });

  test('BreadcrumbList positions are 1-based and absolute', () => {
    const bc = breadcrumbJsonLd([
      { name: 'Mesaas', path: '/' },
      { name: 'Preços', path: '/precos' },
    ]) as { itemListElement: Array<{ position: number; item: string }> };
    expect(bc.itemListElement[0].position).toBe(1);
    expect(bc.itemListElement[1].item).toBe('https://www.mesaas.com.br/precos');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/jsonld.test.ts`
Expected: FAIL — `Cannot find module '../jsonld'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/content/jsonld.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/jsonld.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/jsonld.ts apps/crm/src/content/__tests__/jsonld.test.ts
git commit -m "feat(seo): add JSON-LD builders (Organization, WebSite, SoftwareApplication, FAQPage, Breadcrumb)"
```

---

### Task 3: Head-tag builder (`seo-head.ts`)

**Files:**
- Create: `apps/crm/src/content/seo-head.ts`
- Test: `apps/crm/src/content/__tests__/seo-head.test.ts`

**Interfaces:**
- Consumes: `RouteMeta`, `SITE_URL`, `SITE_NAME`, `DEFAULT_OG_IMAGE` (Task 1).
- Produces: `canonicalUrl(path: string): string`, `buildHeadTags(meta: RouteMeta, jsonLd?: object[]): string`. JSON-LD `<script>` tags carry `data-seo="jsonld"` so the client hook (Task 15) can swap them on SPA navigation.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/content/__tests__/seo-head.test.ts
import { describe, expect, test } from 'vitest';
import { buildHeadTags, canonicalUrl } from '../seo-head';
import type { RouteMeta } from '../site-meta';

const META: RouteMeta = {
  path: '/precos',
  file: 'precos.html',
  title: 'Título de teste com <aspas> & "escapes" p/ verificação ok',
  description:
    'Descrição de teste suficientemente longa para simular um caso real de metadados na página de preços do produto.',
  lastmod: '2026-07-24',
};

describe('seo-head', () => {
  test('canonicalUrl handles root and subpaths', () => {
    expect(canonicalUrl('/')).toBe('https://www.mesaas.com.br/');
    expect(canonicalUrl('/precos')).toBe('https://www.mesaas.com.br/precos');
  });

  test('buildHeadTags emits title, description, canonical, OG and Twitter', () => {
    const head = buildHeadTags(META);
    expect(head).toContain('<title>');
    expect(head).toContain('&lt;aspas&gt;');
    expect(head).toContain('<link rel="canonical" href="https://www.mesaas.com.br/precos" />');
    expect(head).toContain('property="og:title"');
    expect(head).toContain('property="og:image"');
    expect(head).toContain('property="og:locale" content="pt_BR"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
  });

  test('JSON-LD blocks are tagged for client swap and serialized with < escaped', () => {
    const head = buildHeadTags(META, [{ '@type': 'Thing', name: 'a</script>b' }]);
    expect(head).toContain('<script type="application/ld+json" data-seo="jsonld">');
    expect(head).not.toContain('</script>b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/seo-head.test.ts`
Expected: FAIL — `Cannot find module '../seo-head'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/content/seo-head.ts
import type { RouteMeta } from './site-meta';
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from './site-meta';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

export function canonicalUrl(path: string): string {
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/** Head block injected by scripts/seo/prerender.tsx. Indentation matches the
 * two-space style of apps/crm/index.html. */
export function buildHeadTags(meta: RouteMeta, jsonLd: object[] = []): string {
  const url = canonicalUrl(meta.path);
  const image = meta.ogImage ?? DEFAULT_OG_IMAGE;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];
  for (const block of jsonLd) {
    tags.push(
      `<script type="application/ld+json" data-seo="jsonld">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    );
  }
  return tags.join('\n    ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/seo-head.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/seo-head.ts apps/crm/src/content/__tests__/seo-head.test.ts
git commit -m "feat(seo): add head-tag builder for prerendered routes"
```

---

### Task 4: Base shell meta + client-side `usePageMeta` hook

**Files:**
- Modify: `apps/crm/index.html` (title + description lines only)
- Create: `apps/crm/src/lib/usePageMeta.ts`
- Test: `apps/crm/src/lib/__tests__/usePageMeta.test.ts`
- Modify: `apps/crm/src/pages/novidades/NovidadesPage.tsx`, `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx`, `apps/crm/src/pages/termos-de-uso/TermosPage.tsx`, `apps/crm/src/pages/lgpd/LgpdPage.tsx` (one hook call each)

**Interfaces:**
- Consumes: `routeMetaFor`, `DEFAULT_OG_IMAGE` (Task 1), `canonicalUrl` (Task 3).
- Produces: `usePageMeta(path: string): void` — syncs title, description, canonical, og:title/description/url/image and twitter:title/description/image on client navigation. (JSON-LD swap is added to this hook in Task 15, once the per-route JSON-LD registry exists.) Every public page component calls this with its own route path. The hook is `useEffect`-only, so it is a no-op under `renderToStaticMarkup` — required because Task 16 prerenders the legal pages by rendering these exact components.

- [ ] **Step 1: Update the SPA shell meta**

In `apps/crm/index.html` replace:

```html
    <title>Mesaas - Gestão Inteligente</title>
    <meta name="description" content="Mesaas - Plataforma completa para gerenciamento corporativo." />
```

with:

```html
    <title>Mesaas — CRM para agências e gestores de social media</title>
    <meta name="description" content="CRM para social media: clientes, aprovação de posts por link, agendamento automático no Instagram, relatórios e financeiro em um só lugar. Comece grátis." />
```

(Exact same strings as the `/` entry in `site-meta.ts`.)

- [ ] **Step 2: Write the failing hook test**

```ts
// apps/crm/src/lib/__tests__/usePageMeta.test.ts
import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageMeta } from '../usePageMeta';

describe('usePageMeta', () => {
  test('sets title, description, canonical, OG and Twitter tags', () => {
    renderHook(() => usePageMeta('/precos'));
    expect(document.title).toBe('Preços do Mesaas — planos para agências de social media');
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('Compare os planos');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.mesaas.com.br/precos',
    );
    expect(
      document.head.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
    ).toBe('https://www.mesaas.com.br/og-image.png');
  });

  test('navigating to another route leaves no stale tags', () => {
    const { rerender } = renderHook(({ p }: { p: string }) => usePageMeta(p), {
      initialProps: { p: '/precos' },
    });
    rerender({ p: '/sobre' });
    expect(document.title).toBe('Sobre o Mesaas — quem constrói o CRM para social media');
    expect(
      document.head.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
    ).toBe('Sobre o Mesaas — quem constrói o CRM para social media');
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });

  test('is a no-op for unknown paths', () => {
    document.title = 'unchanged';
    renderHook(() => usePageMeta('/dashboard'));
    expect(document.title).toBe('unchanged');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/usePageMeta.test.ts`
Expected: FAIL — `Cannot find module '../usePageMeta'`

- [ ] **Step 4: Write the implementation**

```ts
// apps/crm/src/lib/usePageMeta.ts
import { useEffect } from 'react';
// Relative imports on purpose: this hook is in the prerender script's import
// graph (legal pages), which cannot resolve the @/ alias.
import { DEFAULT_OG_IMAGE, routeMetaFor } from '../content/site-meta';
import { canonicalUrl } from '../content/seo-head';

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Keeps head tags in sync on client-side navigation between public pages.
 * Prerendered HTML ships the same values for the initial load. useEffect-only:
 * must stay a no-op under renderToStaticMarkup (legal pages are prerendered
 * by rendering the real components). */
export function usePageMeta(path: string): void {
  useEffect(() => {
    const meta = routeMetaFor(path);
    if (!meta) return;
    const url = canonicalUrl(path);
    const image = meta.ogImage ?? DEFAULT_OG_IMAGE;
    document.title = meta.title;
    upsertMeta('name', 'description', meta.description);
    upsertMeta('property', 'og:title', meta.title);
    upsertMeta('property', 'og:description', meta.description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:image', image);
    upsertMeta('name', 'twitter:title', meta.title);
    upsertMeta('name', 'twitter:description', meta.description);
    upsertMeta('name', 'twitter:image', image);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;
  }, [path]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/usePageMeta.test.ts`
Expected: PASS

- [ ] **Step 6: Wire into the four existing public pages**

In each of `NovidadesPage.tsx`, `PoliticaPage.tsx`, `TermosPage.tsx`, `LgpdPage.tsx`, add at the top of the default component function:

```ts
usePageMeta('/novidades'); // or the page's own path
```

Import paths: `NovidadesPage` may use `@/lib/usePageMeta`, but the three legal pages MUST import it relatively (`import { usePageMeta } from '../../lib/usePageMeta';`) — they are imported by the prerender script, which cannot resolve the alias (see Global Constraints).

(The legal pages currently have zero imports — this adds their first one. That's fine; the hook is SSR-safe as noted above. LandingPage gets its call in Task 5, new pages in their own tasks.)

- [ ] **Step 7: Run the whole frontend suite**

Run: `npm run test`
Expected: PASS (no page test asserts the old title; if one does, update it to the new manifest title).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/index.html apps/crm/src/lib/usePageMeta.ts apps/crm/src/lib/__tests__/usePageMeta.test.ts apps/crm/src/pages/novidades/NovidadesPage.tsx apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx apps/crm/src/pages/termos-de-uso/TermosPage.tsx apps/crm/src/pages/lgpd/LgpdPage.tsx
git commit -m "feat(seo): fix base shell meta and sync head tags on client navigation"
```

---

### Task 5: Landing copy extraction + heading-hierarchy fixes + footer links

**Files:**
- Create: `apps/crm/src/content/landing.content.ts`
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx`
- Modify: `apps/crm/src/pages/landing/landing.css` (only selectors tied to changed tags)

**Interfaces:**
- Consumes: `usePageMeta` (Task 4).
- Produces: `LANDING` const with shape below — Task 6's renderer and the prerender FAQ JSON-LD read from it. `LandingPage` must render **byte-identical copy** from it.

```ts
export interface LandingFaqItem { q: string; a: string }
export interface LandingFeature { title: string; description: string; bullets: string[] }
export interface LandingHowStep { n: string; title: string; description: string }
export const LANDING: {
  hero: { eyebrow: string; titleBefore: string; titleEm: string; titleAfter: string; sub: string };
  ticker: string[];
  featuresTitle: string;
  featuresSub: string;
  features: LandingFeature[];
  agente: { title: string; paragraphs: string[]; bullets: string[] };
  how: { title: string; steps: LandingHowStep[] };
  faq: LandingFaqItem[];
};
```

- [ ] **Step 1: Create `landing.content.ts` by moving the exact strings**

Move — do not rewrite — the copy currently inlined in `LandingPage.tsx`:
- Hero (lines ~185–200): eyebrow `'Comece grátis · Sem cartão de crédito'`; h1 split as `titleBefore: 'Sua agência de social media '`, `titleEm: 'sem caos'`, `titleAfter: ', sem planilha, sem grupo de WhatsApp.'`; the `hero-sub` paragraph.
- Ticker items array (lines ~225–238, 12 strings from `'Clientes + contratos'` to `'Integração Meta API'`).
- Features section head (h2 `'Tudo que sua agência já faz — só que organizado.'` + its intro paragraph) and the six feature blocks (lines 254–492; h3 titles: `'Kanban de entregas que sua equipe entende no primeiro dia'`, `'Agende e publique no Instagram — sem sair do Mesaas.'`, `'Métricas reais do Instagram — prontas para o relatório.'`, `'Portal do cliente que o cliente realmente usa'`, `'Calendário editorial por cliente ou unificado'`, `'Financeiro sem planilha paralela'`). For each: h3 → `title`, intro `<p>` → `description`, the `<li>` texts → `bullets` (empty array if a block has no list).
- Agente section (lines 492–552): h2 `'Um agente de conteúdo que escreve com a voz de cada cliente.'`, its paragraphs and bullet items.
- How section (lines 552–575): h2 `'Três passos entre você e uma operação organizada.'` and the three `{n, t, d}` steps → `{n, title, description}`.
- FAQ items (lines ~814–842): the seven `{q, a}` objects verbatim (from `'O Mesaas tem plano gratuito?'` through `'Posso cancelar quando quiser?'`).

Then refactor `LandingPage.tsx` to import `LANDING` and render from it (e.g. `<h1 className="hero-title">{LANDING.hero.titleBefore}<em>{LANDING.hero.titleEm}</em>{LANDING.hero.titleAfter}</h1>`, `LANDING.faq.map(...)`, etc.). JSX structure, class names and visuals stay identical.

- [ ] **Step 2: Fix the heading hierarchy**

- Line ~563: change `<h4>{s.t}</h4>` in the how-steps to `<h3>{s.t}</h3>`; in `landing.css`, update any `.how-step h4` selector to `.how-step h3`.
- Lines ~943/965: footer column labels `<h5>Produto</h5>` / `<h5>Legal</h5>` are not document headings — replace with `<p className="ft-label">Produto</p>` (and `Legal`); rename the matching CSS selector (search `landing.css` for `h5`) to `.ft-label`, keeping the same declarations.
- `grep -n "<h4\|<h5\|<h6" apps/crm/src/pages/landing/LandingPage.tsx` must return nothing afterwards.

- [ ] **Step 3: Real internal links in the footer + hook call**

In the footer "Produto" column, add crawlable links (plain `<a>`, same styling as existing footer links) to the new pages so every marketing page is reachable by href:

```tsx
<a href="/aprovacao-de-post">Aprovação de posts</a>
<a href="/portal-do-cliente">Portal do cliente</a>
<a href="/agente-de-conteudo-ia">Agente de conteúdo IA</a>
<a href="/precos">Planos e preços</a>
<a href="/sobre">Sobre</a>
<a href="/novidades">Novidades</a>
```

Keep any existing anchor links. Also add `usePageMeta('/')` at the top of the `LandingPage` component.

- [ ] **Step 4: Run the landing tests**

Run: `npx vitest run apps/crm/src/pages/landing`
Expected: PASS (copy is unchanged, so text queries still match). Then `npm run build` — expected: clean tsc + vite build.

- [ ] **Step 5: Visual check**

Start the dev server (preview tool, `npm run dev` config) and load `/`: hero, features, agente, how, FAQ, footer identical to before; new footer links navigate.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/content/landing.content.ts apps/crm/src/pages/landing/LandingPage.tsx apps/crm/src/pages/landing/landing.css
git commit -m "refactor(landing): extract copy to content module, fix heading hierarchy, add footer links"
```

---

### Task 6: Landing SEO mirror (`landing.seo.ts`)

**Files:**
- Create: `apps/crm/src/content/landing.seo.ts`
- Test: `apps/crm/src/content/__tests__/landing.seo.test.ts`

**Interfaces:**
- Consumes: `LANDING` (Task 5).
- Produces: `renderLandingHtml(): string` — semantic, escaped HTML injected into `#root` of `dist/index.html` by Task 16.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/content/__tests__/landing.seo.test.ts
import { describe, expect, test } from 'vitest';
import { renderLandingHtml } from '../landing.seo';
import { LANDING } from '../landing.content';

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
}

describe('renderLandingHtml', () => {
  const html = renderLandingHtml();

  test('has exactly one h1 with the hero copy', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Sua agência de social media');
  });

  test('never skips a heading level', () => {
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test('includes every feature and FAQ entry', () => {
    for (const f of LANDING.features) expect(html).toContain(f.title.replace(/&/g, '&amp;'));
    for (const item of LANDING.faq) expect(html).toContain(item.q.replace(/&/g, '&amp;'));
  });

  test('links to the funnel pages', () => {
    expect(html).toContain('href="/precos"');
    expect(html).toContain('href="/aprovacao-de-post"');
    expect(html).toContain('href="/agente-de-conteudo-ia"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/landing.seo.test.ts`
Expected: FAIL — `Cannot find module '../landing.seo'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/content/landing.seo.ts
import { LANDING } from './landing.content';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function bullets(items: string[]): string {
  return items.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
}

/** Minimal, escaped, semantic HTML mirror of the landing page for crawlers.
 * Same pattern as changelog.seo.ts. Copy comes from landing.content.ts, so
 * the mirror can never drift from what React renders. */
export function renderLandingHtml(): string {
  const { hero, features, featuresTitle, featuresSub, agente, how, faq } = LANDING;
  const h1 = `${esc(hero.titleBefore)}<em>${esc(hero.titleEm)}</em>${esc(hero.titleAfter)}`;
  const featureBlocks = features
    .map((f) => `<article><h3>${esc(f.title)}</h3><p>${esc(f.description)}</p>${bullets(f.bullets)}</article>`)
    .join('');
  const steps = how.steps
    .map((s) => `<article><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p></article>`)
    .join('');
  const faqBlocks = faq
    .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
    .join('');
  const nav = [
    ['/aprovacao-de-post', 'Aprovação de posts'],
    ['/portal-do-cliente', 'Portal do cliente'],
    ['/agente-de-conteudo-ia', 'Agente de conteúdo IA'],
    ['/precos', 'Planos e preços'],
    ['/sobre', 'Sobre o Mesaas'],
    ['/novidades', 'Novidades'],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join(' · ');
  return [
    `<h1>${h1}</h1>`,
    `<p>${esc(hero.sub)}</p>`,
    `<section><h2>${esc(featuresTitle)}</h2><p>${esc(featuresSub)}</p>${featureBlocks}</section>`,
    `<section><h2>${esc(agente.title)}</h2>${agente.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${bullets(agente.bullets)}</section>`,
    `<section><h2>${esc(how.title)}</h2>${steps}</section>`,
    `<section><h2>Perguntas frequentes</h2>${faqBlocks}</section>`,
    `<nav>${nav}</nav>`,
  ].join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/landing.seo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/landing.seo.ts apps/crm/src/content/__tests__/landing.seo.test.ts
git commit -m "feat(seo): add crawler-facing HTML mirror of the landing page"
```

---

### Task 7: Shared landing chrome (header/footer/pricing/FAQ extraction)

**Files:**
- Create: `apps/crm/src/pages/landing/LandingChrome.tsx` (exports `LandingHeader`, `LandingFooter`, `useLandingChrome`)
- Create: `apps/crm/src/pages/landing/PricingSection.tsx` (exports `PricingSection`)
- Create: `apps/crm/src/pages/landing/FaqSection.tsx` (exports `FaqSection`)
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx`

**Interfaces:**
- Consumes: `LANDING.faq` (Task 5).
- Produces:
  - `LandingHeader({ variant }: { variant: 'landing' | 'subpage' })` — on `'landing'`, nav buttons call the existing `scrollTo(id)`; on `'subpage'`, nav renders `<a href="/#features">` etc. Auth-aware CTAs identical to today.
  - `LandingFooter(): JSX.Element` — the footer moved verbatim (with Task 5's links).
  - `useLandingChrome(): void` — moves the existing `document.body.classList.add('landing-page')` effect (LandingPage.tsx ~line 53) so subpages get the same styling scope.
  - `PricingSection(): JSX.Element` — the whole `Pricing()` section moved verbatim: `PLAN_MARKETING`, `annualSavingsPct`, `displayLimit`, the `PROMO_CODE` import, the `IntersectionObserver` lazy fetch, `PlanComparison` usage.
  - `FaqSection({ items }: { items: Array<{ q: string; a: string }> })` — the `Faq()` component generalized to take items (landing passes `LANDING.faq`).

- [ ] **Step 1: Move the components**

Cut `Header`, `Footer`, `Pricing` (+ its module-level helpers), and `Faq` out of `LandingPage.tsx` into the three new files, adjusting imports (they currently share imports like `useAuth`, `useQuery`, `listPublicPricingPlans`, lucide icons — move what each file needs). `LandingPage.tsx` imports them back. `Faq` becomes `FaqSection({ items })`; the open/close `useState` stays inside.

- [ ] **Step 2: Add hash-scroll support to LandingPage**

Subpage headers link to `/#features`; the landing must honor the hash after lazy mount. Add to `LandingPage`:

```tsx
useEffect(() => {
  const id = window.location.hash.slice(1);
  if (!id) return;
  document.getElementById(id)?.scrollIntoView();
}, []);
```

- [ ] **Step 3: Run landing tests + typecheck**

Run: `npx vitest run apps/crm/src/pages/landing && npm run build`
Expected: PASS / clean build. The extraction moves code without changing behavior.

- [ ] **Step 4: Visual check**

Dev server: `/` unchanged (pricing loads on scroll, FAQ toggles, header CTAs correct logged-out).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/landing
git commit -m "refactor(landing): extract header, footer, pricing and FAQ into reusable components"
```

---

### Task 8: `/precos` page

**Files:**
- Create: `apps/crm/src/pages/precos/PrecosPage.tsx`
- Create: `apps/crm/src/content/precos.content.ts`
- Create: `apps/crm/src/content/precos.seo.ts`
- Test: `apps/crm/src/pages/precos/__tests__/PrecosPage.test.tsx`, `apps/crm/src/content/__tests__/precos.seo.test.ts`
- Modify: `apps/crm/src/App.tsx` (route)

**Interfaces:**
- Consumes: `LandingHeader`, `LandingFooter`, `useLandingChrome`, `PricingSection`, `FaqSection` (Task 7), `usePageMeta` (Task 4).
- Produces: `PRECOS` const (`{ h1; sub; plans; faq }`) and `renderPrecosHtml(): string` — consumed by Tasks 15/16.

- [ ] **Step 1: Write the content module**

```ts
// apps/crm/src/content/precos.content.ts
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
```

(Plan descriptions mirror `PLAN_MARKETING` in `PricingSection.tsx` — keep the strings identical.)

- [ ] **Step 2: Write the page**

```tsx
// apps/crm/src/pages/precos/PrecosPage.tsx
import '../landing/landing.css';
import { LandingHeader, LandingFooter, useLandingChrome } from '../landing/LandingChrome';
import { PricingSection } from '../landing/PricingSection';
import { FaqSection } from '../landing/FaqSection';
import { PRECOS } from '@/content/precos.content';
import { usePageMeta } from '@/lib/usePageMeta';

export default function PrecosPage() {
  useLandingChrome();
  usePageMeta('/precos');
  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <h1 className="hero-title">{PRECOS.h1}</h1>
              <p className="hero-sub">{PRECOS.sub}</p>
            </div>
          </div>
        </section>
        <PricingSection />
        <FaqSection items={[...PRECOS.faq]} />
      </main>
      <LandingFooter />
    </>
  );
}
```

`PricingSection` renders its own `<h2>`, so hierarchy is h1 → h2 → h3.

- [ ] **Step 3: SEO mirror + tests**

```ts
// apps/crm/src/content/precos.seo.ts
import { PRECOS } from './precos.content';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Static mirror of /precos. Live price values are client-fetched, so the
 * mirror carries plan names + positioning copy, not numbers. */
export function renderPrecosHtml(): string {
  const plans = PRECOS.plans
    .map((p) => `<article><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></article>`)
    .join('');
  const faq = PRECOS.faq
    .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
    .join('');
  return [
    `<h1>${esc(PRECOS.h1)}</h1>`,
    `<p>${esc(PRECOS.sub)}</p>`,
    `<section><h2>Compare os planos</h2>${plans}</section>`,
    `<section><h2>Perguntas frequentes</h2>${faq}</section>`,
    `<nav><a href="/">Mesaas</a> · <a href="/aprovacao-de-post">Aprovação de posts</a> · <a href="/portal-do-cliente">Portal do cliente</a> · <a href="/agente-de-conteudo-ia">Agente de conteúdo IA</a></nav>`,
  ].join('');
}
```

```ts
// apps/crm/src/content/__tests__/precos.seo.test.ts
import { describe, expect, test } from 'vitest';
import { renderPrecosHtml } from '../precos.seo';
import { PRECOS } from '../precos.content';

describe('renderPrecosHtml', () => {
  const html = renderPrecosHtml();
  test('one h1, all plans, all FAQs', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const p of PRECOS.plans) expect(html).toContain(p.name);
    for (const i of PRECOS.faq) expect(html).toContain(i.q.replace(/&/g, '&amp;'));
  });
});
```

```tsx
// apps/crm/src/pages/precos/__tests__/PrecosPage.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import PrecosPage from '../PrecosPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/precos']}>
        <PrecosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PrecosPage', () => {
  it('renders the pricing h1 and FAQ', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Planos e preços/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Posso trocar de plano depois?')).toBeInTheDocument();
  });
});
```

(If `PricingSection`'s `IntersectionObserver` path needs the observer in jsdom, the section already falls back to `setShouldLoadPlans(true)` when `IntersectionObserver` is undefined — same as today's landing test environment.)

- [ ] **Step 4: Register the route**

In `apps/crm/src/App.tsx`, add with the other public lazy imports and routes:

```tsx
const PrecosPage = lazy(() => import('./pages/precos/PrecosPage'));
// ...
<Route path="/precos" element={<PrecosPage />} />
```

- [ ] **Step 5: Run tests, build, visual check**

Run: `npx vitest run apps/crm/src/pages/precos apps/crm/src/content/__tests__/precos.seo.test.ts && npm run build`
Expected: PASS. Dev server: `/precos` shows hero + live pricing + FAQ with landing styling.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/precos apps/crm/src/content/precos.content.ts apps/crm/src/content/precos.seo.ts apps/crm/src/content/__tests__/precos.seo.test.ts apps/crm/src/App.tsx
git commit -m "feat(seo): add dedicated /precos page with static SEO mirror"
```

---

### Task 9: Marketing-page template + renderer

**Files:**
- Create: `apps/crm/src/content/paginas.ts` (types + registry)
- Create: `apps/crm/src/content/paginas.seo.ts`
- Create: `apps/crm/src/pages/marketing/MarketingPage.tsx`
- Test: `apps/crm/src/content/__tests__/paginas.seo.test.ts`, `apps/crm/src/pages/marketing/__tests__/MarketingPage.test.tsx`

**Interfaces:**
- Consumes: `LandingHeader`, `LandingFooter`, `useLandingChrome`, `FaqSection` (Task 7), `usePageMeta` (Task 4).
- Produces:

```ts
export interface MarketingPageContent {
  slug: string; // '/<slug>' must exist in PUBLIC_ROUTES
  eyebrow: string;
  h1: string;
  sub: string;
  sections: Array<{ h2: string; paragraphs: string[]; bullets?: string[] }>;
  faq: Array<{ q: string; a: string }>;
  cta: { title: string; sub: string };
}
export const MARKETING_PAGES: MarketingPageContent[]; // filled by Tasks 10–13
export function marketingPageBySlug(slug: string): MarketingPageContent | undefined;
// paginas.seo.ts:
export function renderMarketingPageHtml(page: MarketingPageContent): string;
// MarketingPage.tsx (default export):
export default function MarketingPage({ page }: { page: MarketingPageContent }): JSX.Element;
```

- [ ] **Step 1: Write the failing renderer test**

```ts
// apps/crm/src/content/__tests__/paginas.seo.test.ts
import { describe, expect, test } from 'vitest';
import { renderMarketingPageHtml } from '../paginas.seo';
import { MARKETING_PAGES } from '../paginas';
import { PUBLIC_ROUTES } from '../site-meta';
import type { MarketingPageContent } from '../paginas';

const SAMPLE: MarketingPageContent = {
  slug: 'exemplo',
  eyebrow: 'Recurso',
  h1: 'Título da página',
  sub: 'Subtítulo da página.',
  sections: [{ h2: 'Seção', paragraphs: ['Par.'], bullets: ['Item A'] }],
  faq: [{ q: 'P?', a: 'R.' }],
  cta: { title: 'Pronto?', sub: 'Comece grátis.' },
};

describe('renderMarketingPageHtml', () => {
  const html = renderMarketingPageHtml(SAMPLE);
  test('semantic structure: single h1, sections, faq, CTA link', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h2>Seção</h2>');
    expect(html).toContain('<li>Item A</li>');
    expect(html).toContain('P?');
    expect(html).toContain('href="/login?tab=register"');
  });
});

describe('MARKETING_PAGES registry', () => {
  test('every page has a matching PUBLIC_ROUTES entry', () => {
    for (const p of MARKETING_PAGES) {
      expect(PUBLIC_ROUTES.some((r) => r.path === `/${p.slug}`)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/paginas.seo.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement types, empty registry, renderer, template**

```ts
// apps/crm/src/content/paginas.ts
export interface MarketingPageContent {
  slug: string;
  eyebrow: string;
  h1: string;
  sub: string;
  sections: Array<{ h2: string; paragraphs: string[]; bullets?: string[] }>;
  faq: Array<{ q: string; a: string }>;
  cta: { title: string; sub: string };
}

/** Populated by the per-page content modules. Tasks 10–13 each create a file
 * under content/paginas/ exporting its const and add it to this array. */
export const MARKETING_PAGES: MarketingPageContent[] = [];

export function marketingPageBySlug(slug: string): MarketingPageContent | undefined {
  return MARKETING_PAGES.find((p) => p.slug === slug);
}
```

```ts
// apps/crm/src/content/paginas.seo.ts
import type { MarketingPageContent } from './paginas';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

export function renderMarketingPageHtml(page: MarketingPageContent): string {
  const sections = page.sections
    .map((s) => {
      const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
      const list = s.bullets?.length
        ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
        : '';
      return `<section><h2>${esc(s.h2)}</h2>${paras}${list}</section>`;
    })
    .join('');
  const faq = page.faq.length
    ? `<section><h2>Perguntas frequentes</h2>${page.faq
        .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
        .join('')}</section>`
    : '';
  return [
    `<h1>${esc(page.h1)}</h1>`,
    `<p>${esc(page.sub)}</p>`,
    sections,
    faq,
    `<section><h2>${esc(page.cta.title)}</h2><p>${esc(page.cta.sub)}</p><a href="/login?tab=register">Criar conta grátis</a></section>`,
    `<nav><a href="/">Mesaas</a> · <a href="/precos">Planos e preços</a> · <a href="/novidades">Novidades</a></nav>`,
  ].join('');
}
```

```tsx
// apps/crm/src/pages/marketing/MarketingPage.tsx
import '../landing/landing.css';
import { LandingHeader, LandingFooter, useLandingChrome } from '../landing/LandingChrome';
import { FaqSection } from '../landing/FaqSection';
import { ArrowRight } from 'lucide-react';
import type { MarketingPageContent } from '@/content/paginas';
import { usePageMeta } from '@/lib/usePageMeta';

export default function MarketingPage({ page }: { page: MarketingPageContent }) {
  useLandingChrome();
  usePageMeta(`/${page.slug}`);
  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <span className="eyebrow-pill">{page.eyebrow}</span>
              <h1 className="hero-title">{page.h1}</h1>
              <p className="hero-sub">{page.sub}</p>
            </div>
          </div>
        </section>
        {page.sections.map((s) => (
          <section className="lp-pad" key={s.h2}>
            <div className="lp-container">
              <div className="section-head">
                <h2>{s.h2}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {s.bullets?.length ? (
                  <ul>
                    {s.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>
        ))}
        {page.faq.length > 0 && <FaqSection items={[...page.faq]} />}
        <section className="cta-final-wrap">
          <div className="lp-container">
            <h2>{page.cta.title}</h2>
            <p>{page.cta.sub}</p>
            <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
              Criar conta grátis <ArrowRight size={16} />
            </a>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
```

(Match the CTA markup/classes to the existing `cta-final-wrap` block in `LandingPage.tsx` lines ~880–900 — reuse its exact structure so styling holds.)

```tsx
// apps/crm/src/pages/marketing/__tests__/MarketingPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MarketingPageContent } from '@/content/paginas';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MarketingPage from '../MarketingPage';

const SAMPLE: MarketingPageContent = {
  slug: 'exemplo',
  eyebrow: 'Recurso',
  h1: 'Título da página',
  sub: 'Subtítulo da página.',
  sections: [{ h2: 'Seção', paragraphs: ['Par.'], bullets: ['Item A'] }],
  faq: [{ q: 'P?', a: 'R.' }],
  cta: { title: 'Pronto?', sub: 'Comece grátis.' },
};

describe('MarketingPage', () => {
  it('renders h1, sections, faq and CTA from content', () => {
    render(
      <MemoryRouter>
        <MarketingPage page={SAMPLE} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Título da página' })).toBeInTheDocument();
    expect(screen.getByText('Seção')).toBeInTheDocument();
    expect(screen.getByText('P?')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Criar conta grátis/ }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/content/__tests__/paginas.seo.test.ts apps/crm/src/pages/marketing`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/paginas.ts apps/crm/src/content/paginas.seo.ts apps/crm/src/pages/marketing
git commit -m "feat(seo): add marketing-page template and static renderer"
```

---

### Task 10: `/sobre` page content

**Files:**
- Create: `apps/crm/src/content/paginas/sobre.ts`
- Modify: `apps/crm/src/content/paginas.ts` (import + list), `apps/crm/src/App.tsx` (route)
- Test: extend `apps/crm/src/content/__tests__/paginas.seo.test.ts`

**Interfaces:**
- Consumes: `MarketingPageContent` (Task 9).
- Produces: `SOBRE: MarketingPageContent`; route `/sobre` rendering `<MarketingPage page={SOBRE} />`; the `MarketingRoute` helper in `App.tsx` used by Tasks 11–13.

- [ ] **Step 1: Write the content**

```ts
// apps/crm/src/content/paginas/sobre.ts
import type { MarketingPageContent } from '../paginas';

export const SOBRE: MarketingPageContent = {
  slug: 'sobre',
  eyebrow: 'Sobre',
  h1: 'O CRM que nasceu dentro de uma agência de social media',
  sub: 'O Mesaas existe para acabar com a operação espalhada em planilhas, Drive e grupos de WhatsApp — o problema que vivemos na prática antes de escrever a primeira linha de código.',
  sections: [
    {
      h2: 'O que é o Mesaas',
      paragraphs: [
        'O Mesaas é uma plataforma brasileira de gestão para agências e gestores de social media. Em um único lugar: cadastro de clientes e contratos, kanban de entregas, calendário editorial, aprovação de posts pelo cliente, agendamento e publicação automática no Instagram, relatórios de métricas e financeiro.',
        'O produto é 100% web, em português, e atende de freelancers a micro-agências com equipes completas.',
      ],
    },
    {
      h2: 'No que acreditamos',
      paragraphs: [
        'Ferramenta de trabalho boa é a que desaparece na tarefa. O caos da operação para aqui: a interface é calma, os fluxos são diretos e o cliente final aprova conteúdo sem precisar criar conta ou baixar aplicativo.',
      ],
      bullets: [
        'Transparência com o cliente da agência: tudo que ele precisa ver está no portal dele.',
        'Automação de verdade: aprovou, agendou, publicou — sem retrabalho.',
        'Dados via API oficial do Meta, nunca scraping.',
      ],
    },
    {
      h2: 'Fale com a gente',
      paragraphs: [
        'Suporte e dúvidas: contato@mesaas.com.br — ou pelo chat dentro da plataforma. Assuntos de privacidade e dados: privacidade@mesaas.com.br. Para acompanhar a evolução do produto, veja a página de novidades, atualizada toda semana.',
      ],
    },
  ],
  faq: [],
  cta: {
    title: 'Conheça o Mesaas por dentro',
    sub: 'Crie uma conta grátis e veja em minutos como sua operação fica organizada.',
  },
};
```

(Both e-mails already appear in the repo's legal pages — `contato@` in TermosPage.tsx:261, `privacidade@` in LgpdPage.tsx:61 — so this is consistent with published copy; the checklist still asks the user to confirm the inboxes are monitored.)

- [ ] **Step 2: Register content + route**

In `paginas.ts`: `import { SOBRE } from './paginas/sobre';` and set `export const MARKETING_PAGES: MarketingPageContent[] = [SOBRE];`.

In `App.tsx`:

```tsx
const MarketingPage = lazy(() => import('./pages/marketing/MarketingPage'));

import { marketingPageBySlug } from '@/content/paginas';
function MarketingRoute({ slug }: { slug: string }) {
  const page = marketingPageBySlug(slug);
  if (!page) return <Navigate to="/" replace />;
  return <MarketingPage page={page} />;
}
// route:
<Route path="/sobre" element={<MarketingRoute slug="sobre" />} />
```

- [ ] **Step 3: Extend the registry test**

In `paginas.seo.test.ts` add:

```ts
test('sobre page renders with organization copy', () => {
  const sobre = MARKETING_PAGES.find((p) => p.slug === 'sobre');
  expect(sobre).toBeDefined();
  expect(renderMarketingPageHtml(sobre!)).toContain('contato@mesaas.com.br');
});
```

- [ ] **Step 4: Run tests + visual check**

Run: `npx vitest run apps/crm/src/content apps/crm/src/pages/marketing && npm run build`
Expected: PASS. Dev server: `/sobre` renders with landing chrome.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/paginas apps/crm/src/content/paginas.ts apps/crm/src/content/__tests__/paginas.seo.test.ts apps/crm/src/App.tsx
git commit -m "feat(seo): add /sobre page (GEO about/contact requirement)"
```

---

### Task 11: `/aprovacao-de-post` page content

**Files:**
- Create: `apps/crm/src/content/paginas/aprovacao-de-post.ts`
- Modify: `apps/crm/src/content/paginas.ts`, `apps/crm/src/App.tsx`

**Interfaces:** same pattern as Task 10; produces `APROVACAO_DE_POST: MarketingPageContent`.

- [ ] **Step 1: Write the content** (keywords: *sistema para aprovação de post*, *plataforma de aprovação de conteúdo*, *aprovação de material do cliente*)

```ts
// apps/crm/src/content/paginas/aprovacao-de-post.ts
import type { MarketingPageContent } from '../paginas';

export const APROVACAO_DE_POST: MarketingPageContent = {
  slug: 'aprovacao-de-post',
  eyebrow: 'Aprovação de posts',
  h1: 'Sistema de aprovação de post: seu cliente aprova por link, sem login',
  sub: 'Chega de mandar arte por WhatsApp e caçar o "aprovado" na conversa. No Mesaas, o cliente recebe um link, revisa o post como ele vai ficar no Instagram, comenta e aprova — de qualquer aparelho.',
  sections: [
    {
      h2: 'Como funciona a aprovação de conteúdo no Mesaas',
      paragraphs: [
        'Cada cliente da sua agência tem um portal próprio, acessado por um link único — sem conta, sem senha, sem aplicativo. Lá ele vê os posts pendentes exatamente como vão ser publicados: imagem, carrossel, legenda e data.',
      ],
      bullets: [
        'O cliente aprova ou pede ajuste com um toque, direto do celular.',
        'Comentários ficam registrados no post — nada se perde em conversa de WhatsApp.',
        'Você acompanha o status de tudo no kanban de entregas: rascunho, revisão interna, aprovação do cliente, agendado, publicado.',
      ],
    },
    {
      h2: 'Aprovou? O post já sai agendado.',
      paragraphs: [
        'Aprovação e publicação vivem no mesmo fluxo. Quando o cliente aprova, o post segue para o agendamento e é publicado automaticamente no Instagram na data marcada — Feed, Reels ou Carrossel, via API oficial do Meta.',
        'Sem exportar, sem repostar em outra ferramenta, sem retrabalho.',
      ],
    },
    {
      h2: 'Por que sair do WhatsApp e da planilha',
      paragraphs: [
        'Aprovação espalhada em conversa gera versão errada publicada, prazo perdido e discussão sem histórico. Com um sistema de aprovação de post, cada material tem status, responsável, prazo e trilha de comentários — e o cliente ganha uma experiência profissional com a cara da sua agência.',
      ],
    },
  ],
  faq: [
    {
      q: 'Meu cliente precisa criar conta para aprovar?',
      a: 'Não. Ele acessa por um link único que você envia. Abre, revisa, comenta e aprova — sem login, sem senha e sem instalar nada.',
    },
    {
      q: 'O que acontece quando o cliente pede ajuste?',
      a: 'O post volta para a etapa de produção com o comentário do cliente registrado. Sua equipe ajusta e reenvia para aprovação no mesmo link.',
    },
    {
      q: 'Funciona no celular?',
      a: 'Sim. O portal de aprovação foi desenhado para o cliente usar no celular, e o CRM da agência também funciona em qualquer navegador.',
    },
    {
      q: 'A publicação após a aprovação é automática?',
      a: 'Sim. Post aprovado entra no calendário e é publicado automaticamente no Instagram na data e hora marcadas, via API oficial do Meta.',
    },
  ],
  cta: {
    title: 'Pare de aprovar post por WhatsApp',
    sub: 'Crie sua conta grátis e envie o primeiro link de aprovação em minutos.',
  },
};
```

- [ ] **Step 2: Register** — add `APROVACAO_DE_POST` to `MARKETING_PAGES` and the route `<Route path="/aprovacao-de-post" element={<MarketingRoute slug="aprovacao-de-post" />} />`.

- [ ] **Step 3: Run tests + visual check**

Run: `npx vitest run apps/crm/src/content && npm run build`
Expected: PASS (registry test covers route-manifest pairing automatically). Dev server: `/aprovacao-de-post` renders.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/content/paginas/aprovacao-de-post.ts apps/crm/src/content/paginas.ts apps/crm/src/App.tsx
git commit -m "feat(seo): add /aprovacao-de-post funnel page"
```

---

### Task 12: `/portal-do-cliente` page content

**Files:**
- Create: `apps/crm/src/content/paginas/portal-do-cliente.ts`
- Modify: `apps/crm/src/content/paginas.ts`, `apps/crm/src/App.tsx`

**Interfaces:** same pattern; produces `PORTAL_DO_CLIENTE: MarketingPageContent`.

- [ ] **Step 1: Write the content** (keywords: *portal do cliente para agência*, *hub do cliente*)

```ts
// apps/crm/src/content/paginas/portal-do-cliente.ts
import type { MarketingPageContent } from '../paginas';

export const PORTAL_DO_CLIENTE: MarketingPageContent = {
  slug: 'portal-do-cliente',
  eyebrow: 'Portal do cliente',
  h1: 'Portal do cliente para agências de social media',
  sub: 'Um hub com a marca da sua agência onde cada cliente acompanha o próprio conteúdo: aprova posts, vê o calendário, responde briefing e envia ideias — tudo por um link, sem senha.',
  sections: [
    {
      h2: 'O que o seu cliente encontra no portal',
      paragraphs: [
        'O portal reúne tudo que o cliente precisa ver — e nada do que ele não precisa. Cada seção foi desenhada para quem não é do marketing: direto, visual e no celular.',
      ],
      bullets: [
        'Aprovações: posts pendentes com preview real de feed, carrossel e Reels.',
        'Postagens: o calendário do que está agendado e do que já foi publicado.',
        'Briefing: as respostas do cliente organizadas, reutilizáveis pela equipe.',
        'Marca: cores, logos e materiais de referência num lugar só.',
        'Ideias: o cliente sugere pautas e a agência transforma em conteúdo.',
      ],
    },
    {
      h2: 'Com a cara da sua agência',
      paragraphs: [
        'O portal usa a cor e a identidade da sua marca — a experiência é da sua agência, não de uma ferramenta terceira. Profissionalize a relação com o cliente sem construir nada do zero.',
      ],
    },
    {
      h2: 'Acesso por link, sem fricção',
      paragraphs: [
        'Cada cliente recebe um link exclusivo e seguro. Nada de criar conta, recuperar senha ou instalar aplicativo — a barreira de adoção que faz portais de cliente fracassarem simplesmente não existe.',
      ],
    },
  ],
  faq: [
    {
      q: 'O portal do cliente é cobrado à parte?',
      a: 'Não. O portal faz parte dos planos do Mesaas — veja na página de preços qual plano libera o recurso para a sua operação.',
    },
    {
      q: 'Posso usar a identidade visual da minha agência?',
      a: 'Sim. O portal aplica a cor da sua marca e sua identidade, para o cliente viver uma experiência da sua agência.',
    },
    {
      q: 'O link do portal é seguro?',
      a: 'Sim. Cada cliente tem um token único e você pode revogar o acesso a qualquer momento pelo CRM.',
    },
    {
      q: 'O cliente vê os outros clientes da agência?',
      a: 'Nunca. Cada portal é isolado: o cliente vê apenas o próprio conteúdo, calendário e materiais.',
    },
  ],
  cta: {
    title: 'Dê um portal profissional para cada cliente',
    sub: 'Crie sua conta grátis e gere o primeiro link de portal em minutos.',
  },
};
```

- [ ] **Step 2: Register** — add to `MARKETING_PAGES` + route `/portal-do-cliente`.

- [ ] **Step 3: Run tests + visual check** — `npx vitest run apps/crm/src/content && npm run build`, dev server `/portal-do-cliente`.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/content/paginas/portal-do-cliente.ts apps/crm/src/content/paginas.ts apps/crm/src/App.tsx
git commit -m "feat(seo): add /portal-do-cliente funnel page"
```

---

### Task 13: `/agente-de-conteudo-ia` page content

**Files:**
- Create: `apps/crm/src/content/paginas/agente-de-conteudo-ia.ts`
- Modify: `apps/crm/src/content/paginas.ts`, `apps/crm/src/App.tsx`

**Interfaces:** same pattern; produces `AGENTE_DE_CONTEUDO_IA: MarketingPageContent`.

**Copy constraint:** do NOT claim AI image generation — that tool does not exist in this repo (removed with Estúdio, PR #241). The MCP server DOES offer media upload + attach (`create_media_upload`, `set_post_media`), which the copy below reflects.

- [ ] **Step 1: Write the content** (territory no competitor occupies — analysis brecha 5)

```ts
// apps/crm/src/content/paginas/agente-de-conteudo-ia.ts
import type { MarketingPageContent } from '../paginas';

export const AGENTE_DE_CONTEUDO_IA: MarketingPageContent = {
  slug: 'agente-de-conteudo-ia',
  eyebrow: 'Agente de conteúdo IA',
  h1: 'Um agente de IA que trabalha dentro do fluxo da sua agência',
  sub: 'Não é mais um chat para copiar e colar. O Mesaas se conecta ao Claude via MCP: o agente lê o briefing e a estratégia de cada cliente, escreve com a voz dele e entrega o post pronto no seu fluxo de aprovação.',
  sections: [
    {
      h2: 'O que o agente de conteúdo faz',
      paragraphs: [
        'Conectado ao seu workspace, o agente tem acesso ao contexto real de cada cliente — briefing, estratégia de conteúdo, marca e posts que mais performaram. Com isso ele produz conteúdo específico, não texto genérico de IA.',
      ],
      bullets: [
        'Cria pautas e transforma pauta em post: legenda, roteiro de Reels ou carrossel.',
        'Escreve com a voz de cada cliente, aprendendo com o histórico do que performou.',
        'Envia e anexa as imagens do post pelo próprio agente — mídia definida sem sair do fluxo.',
        'Cria o rascunho já dentro do Mesaas — pronto para revisão e aprovação do cliente.',
      ],
    },
    {
      h2: 'Integração oficial com o Claude via MCP',
      paragraphs: [
        'O Mesaas expõe um conector MCP (Model Context Protocol) — o padrão aberto para conectar assistentes de IA a ferramentas de trabalho. Você conecta o Claude ao seu workspace em minutos e conversa com seus dados: "crie a pauta da semana com base na estratégia do cliente".',
        'O acesso respeita seu workspace e suas permissões, com chaves que você controla e pode revogar.',
      ],
    },
    {
      h2: 'IA dentro do fluxo, não fora dele',
      paragraphs: [
        'A diferença entre usar um chat de IA e ter um agente de conteúdo é o fluxo. Aqui o resultado não morre numa conversa: vira rascunho no kanban, passa pela sua revisão, vai para aprovação do cliente e sai publicado no Instagram — com o mesmo controle de sempre.',
      ],
    },
  ],
  faq: [
    {
      q: 'Preciso saber programar para usar o agente?',
      a: 'Não. A conexão com o Claude é guiada dentro do Mesaas, em poucos cliques. Depois é conversar em português com o agente.',
    },
    {
      q: 'A IA publica sozinha sem revisão?',
      a: 'Não. O agente cria rascunhos dentro do seu fluxo. Publicação só acontece depois da sua revisão e da aprovação do cliente, como em qualquer post.',
    },
    {
      q: 'O agente aprende a voz de cada cliente?',
      a: 'Sim. Ele usa o briefing, a estratégia de conteúdo e os posts de melhor desempenho de cada cliente como referência de tom e formato.',
    },
    {
      q: 'O que é MCP?',
      a: 'Model Context Protocol é o padrão aberto que conecta assistentes de IA, como o Claude, a ferramentas de trabalho. O Mesaas oferece um conector MCP nativo — seus dados ficam no seu workspace, sob suas permissões.',
    },
  ],
  cta: {
    title: 'Coloque um agente de conteúdo no seu time',
    sub: 'Crie sua conta grátis e conecte o Claude ao seu workspace.',
  },
};
```

- [ ] **Step 2: Register** — add to `MARKETING_PAGES` + route `/agente-de-conteudo-ia`.

- [ ] **Step 3: Run tests + visual check** — `npx vitest run apps/crm/src/content && npm run build`, dev server `/agente-de-conteudo-ia`.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/content/paginas/agente-de-conteudo-ia.ts apps/crm/src/content/paginas.ts apps/crm/src/App.tsx
git commit -m "feat(seo): add /agente-de-conteudo-ia funnel page"
```

---

### Task 14: Real 404s — NotFoundPage, enumerated rewrites, noindex headers

**Files:**
- Create: `apps/crm/src/pages/not-found/NotFoundPage.tsx`
- Test: `apps/crm/src/pages/not-found/__tests__/NotFoundPage.test.tsx`, `apps/crm/src/content/__tests__/vercel-routing.test.ts`
- Modify: `apps/crm/src/App.tsx` (the `*` route), `vercel.json` (rewrites + headers)

**Why:** a broad SPA catch-all rewrite means every unknown URL returns HTTP 200 with the shell — a soft 404 Google may render and index. And robots.txt `Disallow` cannot deindex private routes (Google can index blocked URLs and can't see `noindex` behind a crawl block). Fix: enumerate the app routes explicitly (rewrite → `app.html`, which Task 16 marks `noindex`), send `X-Robots-Tag: noindex, nofollow` on private-area responses, and let genuinely unknown URLs miss every rewrite so Vercel serves `dist/404.html` (written by Task 16) with a real HTTP 404 status.

**Interfaces:**
- Consumes: `APP_ROUTE_PREFIXES`, `PUBLIC_ROUTES` (Task 1).
- Produces: `NotFoundPage` (client-side 404 for SPA navigation); vercel.json routing contract verified by `vercel-routing.test.ts`.

- [ ] **Step 1: Write the failing NotFoundPage test**

```tsx
// apps/crm/src/pages/not-found/__tests__/NotFoundPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import NotFoundPage from '../NotFoundPage';

test('renders 404 with links home and to login, and a noindex meta', () => {
  render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { level: 1, name: /Página não encontrada/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /página inicial/i })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: /Entrar/i })).toHaveAttribute('href', '/login');
  expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
    'noindex',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/not-found`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement NotFoundPage + route**

```tsx
// apps/crm/src/pages/not-found/NotFoundPage.tsx
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  useEffect(() => {
    document.title = 'Página não encontrada — Mesaas';
    let el = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex');
    return () => {
      el?.remove();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-center p-8 gap-4">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="text-muted-foreground">
        O endereço que você acessou não existe ou mudou de lugar.
      </p>
      <div className="flex gap-4">
        <Link to="/" className="underline">
          Ir para a página inicial
        </Link>
        <Link to="/login" className="underline">
          Entrar no Mesaas
        </Link>
      </div>
    </div>
  );
}
```

In `App.tsx`, replace `<Route path="*" element={<Navigate to="/login" replace />} />` with:

```tsx
const NotFoundPage = lazy(() => import('./pages/not-found/NotFoundPage'));
// ...
<Route path="*" element={<NotFoundPage />} />
```

- [ ] **Step 4: Rewrite vercel.json routing**

Replace the `rewrites` array with (order matters; `analytics-fluxos` before `analytics`):

```json
"rewrites": [
  { "source": "/:workspace/hub/:token/(.*)", "destination": "/hub/index.html" },
  { "source": "/:workspace/hub/:token", "destination": "/hub/index.html" },
  { "source": "/admin/(.*)", "destination": "/admin/index.html" },
  { "source": "/precos", "destination": "/precos.html" },
  { "source": "/sobre", "destination": "/sobre.html" },
  { "source": "/aprovacao-de-post", "destination": "/aprovacao-de-post.html" },
  { "source": "/portal-do-cliente", "destination": "/portal-do-cliente.html" },
  { "source": "/agente-de-conteudo-ia", "destination": "/agente-de-conteudo-ia.html" },
  { "source": "/novidades", "destination": "/novidades.html" },
  { "source": "/politica-de-privacidade", "destination": "/politica-de-privacidade.html" },
  { "source": "/termos-de-uso", "destination": "/termos-de-uso.html" },
  { "source": "/lgpd", "destination": "/lgpd.html" },
  { "source": "/(login|configurar-senha|workspace-setup|oauth|dashboard|clientes|financeiro|contratos|leads|equipe|configuracao|calendario|entregas|post-express|arquivos|analytics-fluxos|analytics|ideias|ajuda)(/.*)?", "destination": "/app.html" }
]
```

(`/` needs no rewrite: the filesystem serves `dist/index.html`, which the prerender overwrites with the landing content. Unknown URLs match nothing → Vercel serves `404.html` with HTTP 404.)

Append to the `headers` array (keep all existing entries):

```json
{
  "source": "/app.html",
  "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
},
{
  "source": "/(login|configurar-senha|workspace-setup|oauth|dashboard|clientes|financeiro|contratos|leads|equipe|configuracao|calendario|entregas|post-express|arquivos|analytics-fluxos|analytics|ideias|ajuda)(/.*)?",
  "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
},
{
  "source": "/admin(/.*)?",
  "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
},
{
  "source": "/:workspace/hub/:token(/.*)?",
  "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
}
```

- [ ] **Step 5: Write the routing guard test**

This test pins the vercel.json contract to the manifest so a new route can't silently 404 in prod or lose its prerender rewrite:

```ts
// apps/crm/src/content/__tests__/vercel-routing.test.ts
import { describe, expect, test } from 'vitest';
import vercelConfig from '../../../../../vercel.json';
import { APP_ROUTE_PREFIXES, PUBLIC_ROUTES } from '../site-meta';

const rewrites = vercelConfig.rewrites as Array<{ source: string; destination: string }>;
const headers = vercelConfig.headers as Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}>;

describe('vercel.json routing contract', () => {
  test('every app-route prefix is captured by the app-shell rewrite', () => {
    const appShell = rewrites.find((r) => r.destination === '/app.html');
    expect(appShell).toBeDefined();
    for (const prefix of APP_ROUTE_PREFIXES) {
      expect(appShell!.source, `prefix ${prefix} missing from app-shell rewrite`).toContain(prefix);
    }
  });

  test('every prerendered route has an explicit rewrite (or is the filesystem root)', () => {
    for (const r of PUBLIC_ROUTES.filter((r) => r.file && r.path !== '/')) {
      expect(
        rewrites.some((w) => w.source === r.path && w.destination === `/${r.file}`),
        `missing rewrite for ${r.path}`,
      ).toBe(true);
    }
  });

  test('no broad SPA catch-all remains (unknown URLs must 404)', () => {
    expect(rewrites.some((r) => r.source.includes('(?!hub/'))).toBe(false);
  });

  test('app shell and app routes carry X-Robots-Tag noindex', () => {
    const noindexSources = headers
      .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)))
      .map((h) => h.source);
    expect(noindexSources).toContain('/app.html');
    expect(noindexSources.some((s) => s.includes('dashboard'))).toBe(true);
    expect(noindexSources.some((s) => s.includes('/admin'))).toBe(true);
    expect(noindexSources.some((s) => s.includes('hub'))).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run apps/crm/src/pages/not-found apps/crm/src/content/__tests__/vercel-routing.test.ts && npm run test`
Expected: PASS. If any existing test asserts the `*` → `/login` redirect, update it to expect the 404 page.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/not-found apps/crm/src/App.tsx vercel.json apps/crm/src/content/__tests__/vercel-routing.test.ts
git commit -m "feat(seo): real 404s via enumerated rewrites + noindex on private areas"
```

---

### Task 15: Route JSON-LD registry, sitemap and llms.txt builders, hook JSON-LD swap

**Files:**
- Create: `apps/crm/src/content/route-jsonld.ts`
- Create: `apps/crm/src/content/sitemap.ts`
- Create: `apps/crm/src/content/llms.ts`
- Modify: `apps/crm/src/lib/usePageMeta.ts` (JSON-LD swap)
- Test: `apps/crm/src/content/__tests__/route-jsonld.test.ts`, `apps/crm/src/content/__tests__/sitemap.test.ts`, `apps/crm/src/content/__tests__/llms.test.ts`; extend `apps/crm/src/lib/__tests__/usePageMeta.test.ts`
- Delete: `public/sitemap.xml` (now generated into dist/ at build)

**Interfaces:**
- Consumes: Tasks 1–3 helpers, `LANDING` (Task 5), `PRECOS` (Task 8), `MARKETING_PAGES` (Tasks 9–13).
- Produces: `jsonLdForPath(path: string): object[]` (single source for prerender AND client hook), `buildSitemapXml(routes: RouteMeta[]): string`, `buildLlmsTxt(routes: RouteMeta[]): string` — called by Task 16.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/content/__tests__/route-jsonld.test.ts
import { describe, expect, test } from 'vitest';
import { jsonLdForPath } from '../route-jsonld';

function types(blocks: object[]): string[] {
  return blocks.map((b) => (b as { '@type': string })['@type']);
}

describe('jsonLdForPath', () => {
  test('landing gets Organization, WebSite, SoftwareApplication and FAQPage', () => {
    expect(types(jsonLdForPath('/'))).toEqual([
      'Organization',
      'WebSite',
      'SoftwareApplication',
      'FAQPage',
    ]);
  });

  test('precos gets SoftwareApplication and FAQPage', () => {
    expect(types(jsonLdForPath('/precos'))).toContain('SoftwareApplication');
    expect(types(jsonLdForPath('/precos'))).toContain('FAQPage');
  });

  test('marketing page with FAQ gets FAQPage; sobre (no FAQ) does not', () => {
    expect(types(jsonLdForPath('/aprovacao-de-post'))).toContain('FAQPage');
    expect(types(jsonLdForPath('/sobre'))).not.toContain('FAQPage');
  });

  test('legal pages get the base Organization/WebSite pair', () => {
    expect(types(jsonLdForPath('/politica-de-privacidade'))).toEqual(['Organization', 'WebSite']);
  });
});
```

```ts
// apps/crm/src/content/__tests__/sitemap.test.ts
import { describe, expect, test } from 'vitest';
import { buildSitemapXml } from '../sitemap';
import { PUBLIC_ROUTES } from '../site-meta';

describe('buildSitemapXml', () => {
  const xml = buildSitemapXml(PUBLIC_ROUTES);
  test('declares every public route with lastmod', () => {
    for (const r of PUBLIC_ROUTES) {
      const loc =
        r.path === '/' ? 'https://www.mesaas.com.br/' : `https://www.mesaas.com.br${r.path}`;
      expect(xml).toContain(`<loc>${loc}</loc>`);
      expect(xml).toContain(`<lastmod>${r.lastmod}</lastmod>`);
    }
  });
  test('is well-formed enough for Google', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<url>/g)?.length).toBe(PUBLIC_ROUTES.length);
  });
});
```

```ts
// apps/crm/src/content/__tests__/llms.test.ts
import { describe, expect, test } from 'vitest';
import { buildLlmsTxt } from '../llms';
import { PUBLIC_ROUTES } from '../site-meta';

describe('buildLlmsTxt', () => {
  const txt = buildLlmsTxt(PUBLIC_ROUTES);
  test('opens with the brand block and lists every page', () => {
    expect(txt.startsWith('# Mesaas')).toBe(true);
    expect(txt).toContain('> CRM para agências e gestores de social media');
    for (const r of PUBLIC_ROUTES) {
      expect(txt).toContain(`](https://www.mesaas.com.br${r.path === '/' ? '/' : r.path})`);
    }
  });
});
```

Extend `usePageMeta.test.ts`:

```ts
test('swaps JSON-LD blocks on navigation', () => {
  const { rerender } = renderHook(({ p }: { p: string }) => usePageMeta(p), {
    initialProps: { p: '/aprovacao-de-post' },
  });
  const before = document.head.querySelectorAll('script[data-seo="jsonld"]').length;
  expect(before).toBeGreaterThan(0);
  rerender({ p: '/politica-de-privacidade' });
  const scripts = [...document.head.querySelectorAll('script[data-seo="jsonld"]')];
  expect(scripts).toHaveLength(2); // Organization + WebSite only
  expect(scripts.map((s) => s.textContent).join('')).not.toContain('FAQPage');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/content/__tests__/route-jsonld.test.ts apps/crm/src/content/__tests__/sitemap.test.ts apps/crm/src/content/__tests__/llms.test.ts apps/crm/src/lib`
Expected: FAIL — modules missing / hook lacks swap.

- [ ] **Step 3: Implement**

```ts
// apps/crm/src/content/route-jsonld.ts
/** Per-route JSON-LD registry — single source for the prerender script and
 * the client-side usePageMeta swap. */
import {
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from './jsonld';
import { LANDING } from './landing.content';
import { PRECOS } from './precos.content';
import { marketingPageBySlug } from './paginas';

export function jsonLdForPath(path: string): object[] {
  const base = [organizationJsonLd(), webSiteJsonLd()];
  if (path === '/') {
    return [...base, softwareApplicationJsonLd(), faqPageJsonLd([...LANDING.faq])];
  }
  if (path === '/precos') {
    return [...base, softwareApplicationJsonLd(), faqPageJsonLd([...PRECOS.faq])];
  }
  const page = marketingPageBySlug(path.slice(1));
  if (page && page.faq.length) return [...base, faqPageJsonLd([...page.faq])];
  return base;
}
```

```ts
// apps/crm/src/content/sitemap.ts
import type { RouteMeta } from './site-meta';
import { canonicalUrl } from './seo-head';

export function buildSitemapXml(routes: RouteMeta[]): string {
  const urls = routes
    .map((r) => `  <url><loc>${canonicalUrl(r.path)}</loc><lastmod>${r.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
```

```ts
// apps/crm/src/content/llms.ts
import type { RouteMeta } from './site-meta';
import { canonicalUrl } from './seo-head';

/** llms.txt (https://llmstxt.org): tells AI crawlers what Mesaas is and where
 * the substantive pages live. Regenerated on every build from the manifest. */
export function buildLlmsTxt(routes: RouteMeta[]): string {
  const pages = routes
    .map((r) => `- [${r.title}](${canonicalUrl(r.path)}): ${r.description}`)
    .join('\n');
  return [
    '# Mesaas',
    '',
    '> CRM para agências e gestores de social media no Brasil: gestão de clientes e contratos, kanban de entregas, calendário editorial, aprovação de posts pelo cliente via link (sem login), agendamento e publicação automática no Instagram pela API oficial do Meta, relatórios de métricas, financeiro e um agente de conteúdo com IA conectado via MCP (Model Context Protocol).',
    '',
    'O produto é 100% web, em português (pt-BR). Plano Free disponível — sem cartão de crédito.',
    '',
    '## Páginas',
    '',
    pages,
    '',
  ].join('\n');
}
```

Add to the end of the `useEffect` in `usePageMeta.ts` (import `jsonLdForPath` from `../content/route-jsonld` — relative, same reason as the hook's other imports):

```ts
document.head.querySelectorAll('script[data-seo="jsonld"]').forEach((el) => el.remove());
for (const block of jsonLdForPath(path)) {
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.dataset.seo = 'jsonld';
  s.textContent = JSON.stringify(block);
  document.head.appendChild(s);
}
```

Then `git rm public/sitemap.xml` (Task 16's script generates `dist/sitemap.xml`; keeping the static file would ship a stale 2-URL sitemap).

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/crm/src/content apps/crm/src/lib`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/route-jsonld.ts apps/crm/src/content/sitemap.ts apps/crm/src/content/llms.ts apps/crm/src/content/__tests__ apps/crm/src/lib
git rm public/sitemap.xml
git commit -m "feat(seo): route JSON-LD registry, sitemap/llms builders, client JSON-LD swap"
```

---

### Task 16: Prerender pipeline + robots/package/tsconfig wiring

**Files:**
- Create: `scripts/seo/prerender.tsx`
- Delete: `scripts/changelog/prerender.ts`
- Modify: `package.json` (scripts), `vercel.json` (buildCommand only — rewrites/headers were Task 14), `public/robots.txt`, `tsconfig.scripts.json`

**Interfaces:**
- Consumes: everything produced by Tasks 1–15; renders the legal pages by importing the real components (`PoliticaPage`, `TermosPage`, `LgpdPage` — pure JSX + the SSR-safe `usePageMeta` hook) through `renderToStaticMarkup`.
- Produces: `dist/app.html` (SPA shell + `noindex` meta), `dist/404.html` (real 404 body + `noindex`), one `dist/<file>.html` per `PUBLIC_ROUTES` entry (10), `dist/sitemap.xml`, `dist/llms.txt`. `npm run prerender` replaces `npm run prerender:novidades`.

- [ ] **Step 1: Write the script**

```tsx
// scripts/seo/prerender.tsx
/** Post-build prerender for all public marketing routes.
 * - dist/app.html    = SPA shell + noindex meta (served for app routes via vercel.json)
 * - dist/404.html    = branded 404 (Vercel serves it with HTTP 404 for unmatched paths)
 * - dist/<file>.html = shell + per-route head tags + semantic HTML in #root
 * - dist/sitemap.xml, dist/llms.txt
 * Legal pages are rendered from their real React components (pure JSX) via
 * renderToStaticMarkup; the other routes use their .seo.ts mirrors.
 * Run AFTER `vite build` (needs dist/index.html), BEFORE hub/admin builds. */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PUBLIC_ROUTES } from '../../apps/crm/src/content/site-meta';
import { buildHeadTags } from '../../apps/crm/src/content/seo-head';
import { jsonLdForPath } from '../../apps/crm/src/content/route-jsonld';
import { buildSitemapXml } from '../../apps/crm/src/content/sitemap';
import { buildLlmsTxt } from '../../apps/crm/src/content/llms';
import { renderLandingHtml } from '../../apps/crm/src/content/landing.seo';
import { renderPrecosHtml } from '../../apps/crm/src/content/precos.seo';
import { MARKETING_PAGES, marketingPageBySlug } from '../../apps/crm/src/content/paginas';
import { renderMarketingPageHtml } from '../../apps/crm/src/content/paginas.seo';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';
import PoliticaPage from '../../apps/crm/src/pages/politica-privacidade/PoliticaPage';
import TermosPage from '../../apps/crm/src/pages/termos-de-uso/TermosPage';
import LgpdPage from '../../apps/crm/src/pages/lgpd/LgpdPage';

const rawChangelog = JSON.parse(readFileSync('apps/crm/src/content/changelog.json', 'utf8'));
const parsed = changelogSchema.safeParse(rawChangelog);
const releases = parsed.success ? parsed.data.releases : [];

function bodyFor(path: string): string | undefined {
  if (path === '/') return renderLandingHtml();
  if (path === '/precos') return renderPrecosHtml();
  if (path === '/novidades') return renderChangelogHtml(releases);
  if (path === '/politica-de-privacidade') return renderToStaticMarkup(<PoliticaPage />);
  if (path === '/termos-de-uso') return renderToStaticMarkup(<TermosPage />);
  if (path === '/lgpd') return renderToStaticMarkup(<LgpdPage />);
  const page = marketingPageBySlug(path.slice(1));
  return page ? renderMarketingPageHtml(page) : undefined;
}

const shell = readFileSync('dist/index.html', 'utf8');

function stripBaseMeta(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>\n?/, '')
    .replace(/<meta name="description"[^>]*\/>\n?/, '');
}

// App shell: pristine assets, but never indexable.
writeFileSync(
  'dist/app.html',
  shell.replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>'),
);

// Real 404 (Vercel serves dist/404.html with status 404 for unmatched paths).
let notFound = stripBaseMeta(shell);
notFound = notFound.replace(
  '</head>',
  '    <title>Página não encontrada — Mesaas</title>\n    <meta name="robots" content="noindex" />\n  </head>',
);
notFound = notFound.replace(
  '<div id="root"></div>',
  '<div id="root"><h1>Página não encontrada</h1><p>O endereço que você acessou não existe ou mudou de lugar.</p><p><a href="/">Ir para a página inicial</a> · <a href="/login">Entrar no Mesaas</a></p></div>',
);
writeFileSync('dist/404.html', notFound);

let written = 0;
for (const route of PUBLIC_ROUTES) {
  if (!route.file) continue;
  const body = bodyFor(route.path);
  if (body === undefined) {
    throw new Error(`No body renderer registered for prerendered route ${route.path}`);
  }
  let html = stripBaseMeta(shell);
  html = html.replace('</head>', `    ${buildHeadTags(route, jsonLdForPath(route.path))}\n  </head>`);
  html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  writeFileSync(`dist/${route.file}`, html);
  written++;
}

writeFileSync('dist/sitemap.xml', buildSitemapXml(PUBLIC_ROUTES));
writeFileSync('dist/llms.txt', buildLlmsTxt(PUBLIC_ROUTES));
console.log(
  `Prerendered ${written} routes (+app.html, 404.html, sitemap.xml, llms.txt). Marketing pages: ${MARKETING_PAGES.length}.`,
);
```

Then `git rm scripts/changelog/prerender.ts` (novidades is now one route of the generic pipeline; `renderChangelogHtml` and the rest of `scripts/changelog/` stay).

- [ ] **Step 2: Update `package.json` and `tsconfig.scripts.json`**

`package.json` — replace:

```json
"prerender:novidades": "tsx scripts/changelog/prerender.ts",
```

with:

```json
"prerender": "tsx scripts/seo/prerender.tsx",
```

Check for other references: `grep -rn "prerender:novidades" package.json vercel.json .github/ scripts/` and update every hit.

`tsconfig.scripts.json` — CI typechecks scripts with this config (`.github/workflows/ci.yml` "Typecheck scripts"), and today it only includes `scripts/changelog/**/*.ts`. Update:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["scripts/changelog/**/*.ts", "scripts/seo/**/*.ts", "scripts/seo/**/*.tsx"]
}
```

Run `npx tsc -p tsconfig.scripts.json` — expected: clean. (The script imports app modules; if tsc complains about the `@/`-free relative imports or CSS side-effect imports, note the content modules import no CSS by design — only pages do, and the three legal pages have none.)

- [ ] **Step 3: Update `vercel.json` buildCommand**

```json
"buildCommand": "npm run build && npm run prerender && npm run build:hub && npm run build:admin"
```

- [ ] **Step 4: Rewrite `public/robots.txt`**

Deindexing of private areas is handled by `noindex` (meta in app.html + X-Robots-Tag from Task 14) — which only works if crawling is NOT blocked. So robots.txt blocks nothing:

```
User-agent: *
Allow: /

Sitemap: https://www.mesaas.com.br/sitemap.xml
```

(AI crawlers — GPTBot, ClaudeBot, PerplexityBot — remain allowed, as the GEO audit confirmed they are today.)

- [ ] **Step 5: Full local build + inspect output**

```bash
npm run build && npm run prerender
```

Expected: build clean; script logs `Prerendered 10 routes (+app.html, 404.html, sitemap.xml, llms.txt). Marketing pages: 4.`

Verify:

```bash
grep -c 'application/ld+json' dist/index.html          # 4 (Org, WebSite, SoftwareApp, FAQPage)
grep -o '<title>[^<]*</title>' dist/precos.html        # the /precos title from site-meta
grep -c 'og:image' dist/aprovacao-de-post.html         # >= 1
grep -c '<h1' dist/index.html                          # exactly 1
grep -c '<h1' dist/politica-de-privacidade.html        # exactly 1 (rendered component)
grep 'name="robots"' dist/app.html                     # noindex, nofollow
grep 'name="robots"' dist/404.html                     # noindex
grep '<title>' dist/app.html                           # base shell title (unchanged copy)
head -3 dist/llms.txt                                  # "# Mesaas" block
grep -c '<url>' dist/sitemap.xml                       # 10 (all PUBLIC_ROUTES)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/seo/prerender.tsx package.json vercel.json public/robots.txt tsconfig.scripts.json
git rm scripts/changelog/prerender.ts
git commit -m "feat(seo): generic prerender pipeline (incl. legal pages + 404 + noindex shell)"
```

---

### Task 17: OG image

**Files:**
- Create: `scripts/seo/generate-og-image.mjs`
- Create (generated, committed): `public/og-image.png`
- Modify: `package.json` (script)

**Interfaces:** produces the `public/og-image.png` asset that `DEFAULT_OG_IMAGE` (Task 1) already points at. (`.mjs` — not included in tsconfig.scripts.json typecheck, by design.)

- [ ] **Step 1: Write the generator**

```js
// scripts/seo/generate-og-image.mjs
// One-shot generator for the default OG image (1200x630). Rerun and re-commit
// when the tagline changes: npm run og:image
import { chromium } from '@playwright/test';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; padding: 96px; background: #12151a; color: #e8eaf0;
    font-family: 'DM Sans', -apple-system, 'Segoe UI', sans-serif;
  }
  .logo { color: #eab308; font-size: 54px; font-weight: 900; letter-spacing: -1px; }
  h1 { font-size: 66px; font-weight: 800; line-height: 1.12; margin: 28px 0 20px; max-width: 980px; }
  p { font-size: 30px; color: #9ca3af; max-width: 900px; }
</style></head><body>
  <div class="logo">Mesaas</div>
  <h1>CRM para agências e gestores de social media</h1>
  <p>Clientes, aprovações, agendamento no Instagram e relatórios — em um só lugar.</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('Wrote public/og-image.png (1200x630)');
```

Add to `package.json` scripts: `"og:image": "node scripts/seo/generate-og-image.mjs"`.

- [ ] **Step 2: Generate and eyeball**

Run: `npm run og:image`
Expected: `Wrote public/og-image.png (1200x630)`. Open the PNG (Read tool) — dark background, yellow "Mesaas", legible headline. If Playwright's bundled Chromium is missing, run `npx playwright install chromium` first.

- [ ] **Step 3: Commit**

```bash
git add scripts/seo/generate-og-image.mjs public/og-image.png package.json
git commit -m "feat(seo): add default OG image and generator script"
```

---

### Task 18: Final verification + deploy checklist

**Files:**
- Create: `docs/seo-checklist.md`

- [ ] **Step 1: Run every CI gate**

```bash
npm run test                        # all Vitest suites green
npm run lint                        # eslint clean
npm run format                      # prettier auto-fix, then:
npm run format:check                # clean
npx tsc -p tsconfig.scripts.json    # scripts typecheck (CI runs this)
npm run build && npm run prerender  # clean build + 10 prerendered routes
```

Expected: all pass. Fix anything that fails before proceeding.

- [ ] **Step 2: Browser pass (dev server)**

Verify each route renders correctly and identically-styled: `/`, `/precos`, `/sobre`, `/aprovacao-de-post`, `/portal-do-cliente`, `/agente-de-conteudo-ia`, `/novidades`, `/politica-de-privacidade`, `/termos-de-uso`, `/lgpd`, `/qualquer-coisa-invalida` (404 page). Check dark mode toggle still works on the landing, and document.title changes as you navigate between public pages.

- [ ] **Step 3: Write the checklist for post-merge user actions**

```markdown
<!-- docs/seo-checklist.md -->
# SEO/GEO — ações pós-deploy (humanas)

Itens que o código não resolve sozinho. Marcar conforme concluído.

## Imediato (bloqueia o resultado do trabalho técnico)
- [ ] **Google Search Console**: verificar a propriedade do domínio `mesaas.com.br`
      (verificação por DNS cobre www e apex) e submeter `https://www.mesaas.com.br/sitemap.xml`.
- [ ] **Redirecionamento de domínio**: confirmar no painel da Vercel que `mesaas.com.br`
      redireciona (308) para `https://www.mesaas.com.br` — o canonical de todo o site aponta para www.
- [ ] **Confirmar o 404 real em produção**: `curl -sI https://www.mesaas.com.br/url-que-nao-existe`
      deve responder `404` (não `200`).
- [ ] **Perfis sociais**: preencher `SOCIAL_PROFILES` em `apps/crm/src/content/site-meta.ts`
      com as URLs reais (Instagram, LinkedIn, …) para o `sameAs` do schema Organization.
- [ ] **E-mails de contato**: confirmar que `contato@mesaas.com.br` e `privacidade@mesaas.com.br`
      (usados em /sobre, Termos e LGPD) existem e são monitorados.
- [ ] Após o deploy, pedir indexação das 10 URLs principais no Search Console.

## Próximas 2–4 semanas
- [ ] Cruzar impressões do Search Console com o mapa de keywords (análise de 24/07/2026)
      para priorizar as próximas páginas.
- [ ] Validar rich results (FAQ, Organization) em https://search.google.com/test/rich-results.
- [ ] Testar OG/Twitter cards em https://www.opengraph.xyz ou no validador do LinkedIn.
- [ ] Conferir no relatório de indexação do GSC que /dashboard, /login e afins aparecem
      como "Excluída por noindex" (e não indexadas).

## Fases seguintes (planos futuros — ver seção "Out of scope" do plano)
- Fase 1b: páginas /briefing-de-cliente, /agendamento-instagram,
  /relatorio-mensal-instagram, /crm-para-social-media (infra pronta — 1 content module + 1 rota cada).
- Fase 2: blog em markdown prerenderizado + comparativos ("Mesaas vs Aprova Post",
  "alternativa ao Doo Studio", "migração da Etus", comparativo de plataformas de aprovação).
- Fase 3: conteúdo de autoridade IA/MCP (documentar o agente, casos reais).
- Fase 4: ativo proprietário (calculadora de precificação de social media / benchmark de engajamento).
```

- [ ] **Step 4: Commit and hand off**

```bash
git add docs/seo-checklist.md
git commit -m "docs(seo): add post-deploy checklist and next-phase backlog"
```

Then follow `superpowers:finishing-a-development-branch` (PR to `main`).

---

## Out of scope (deliberately)

- **Blog infrastructure and articles** (audit "Tem blog" / "Volume de conteúdo" / "Frequência de postagem"): needs its own plan — markdown collection, `/blog` index, per-post prerender, RSS, sitemap dates. The prerender pipeline built here is the foundation it will plug into.
- **The remaining 4 funnel pages** (Fase 1b) — infra is ready; each is one content module + one route + one manifest entry (plus its vercel.json rewrite, enforced by the guard test).
- **"vs competitor" pages** — editorial work, belongs with the blog phase.
- **Proprietary tools** (calculators, benchmark) — Fase 4.
- **AI image generation on the agent page** — the tool doesn't exist in this repo (removed with Estúdio); re-add the claim if/when the feature returns.
- **SearchAction on WebSite schema** — the site has no public search; adding a fake one hurts.
- **hreflang** — single-language site, not applicable (audit agrees).

## Self-review notes (rev. 2 — after external review)

Review findings addressed:
1. **Legal pages now prerendered** (blocker): they get `file` entries (Task 1), explicit rewrites (Task 14) and are rendered via `renderToStaticMarkup` of the real components (Task 16) — verified pure JSX, zero imports/hooks, so no extraction refactor and no drift. Expected output is 10 routes, not 7.
2. **Real 404s**: broad catch-all replaced by enumerated app-route rewrites + `dist/404.html`; unknown URLs now return HTTP 404 (Task 14/16). Guard test pins the routing contract.
3. **Deindexing**: robots.txt no longer relies on Disallow; `app.html` ships meta `noindex, nofollow`, and X-Robots-Tag headers cover app routes, /admin and hub links (Task 14/16).
4. **Agent-page copy**: image-generation claim replaced with the media upload/attach capability that actually exists (`create_media_upload`/`set_post_media`); constraint recorded in Global Constraints.
5. **Scripts typecheck**: `tsconfig.scripts.json` includes `scripts/seo/**` + `jsx: react-jsx`; `npx tsc -p tsconfig.scripts.json` added to final verification (CI already runs it).
6. **usePageMeta staleness**: hook now syncs twitter:*/og:image too (Task 4) and swaps `data-seo="jsonld"` blocks via the shared `jsonLdForPath` registry (Task 15); navigation tests added.
7. **Spec consistency**: SERP ranges tightened to the audit's 50–60 / 120–160 and every string re-counted; PrecosPage/MarketingPage tests are now complete code (mock pattern taken from LandingPage.test.tsx); visual-parity constraint reworded to name the intentional changes.

Type consistency: `MarketingPageContent` fields (`slug/eyebrow/h1/sub/sections/faq/cta`) used identically in T9–T13; `RouteMeta.file` present on all 10 routes; `FaqSection({ items })` receives spread copies (`[...page.faq]`) because content modules are `as const` readonly. If tsc complains about readonly-array variance in a step, drop `as const` from that module rather than fighting variance.
