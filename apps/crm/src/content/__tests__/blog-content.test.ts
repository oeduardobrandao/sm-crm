import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parsePost } from '../blog.schema';
import { PUBLIC_ROUTES } from '../site-meta';

// Resolved against this file rather than the process cwd: vitest may be invoked
// from the repo root or from apps/crm, and a cwd-relative path turns "a post
// broke a rule" into an ENOENT crash before a single test gets to run.
//
// Deliberately not `new URL('../blog', import.meta.url)`: Vite statically
// rewrites that exact two-argument pattern into an asset import, which yields
// `http://localhost:3000/…/blog.ts` and blows up in fileURLToPath. Taking the
// dirname of the bare `import.meta.url` sidesteps the transform.
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'blog');
const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const posts = files.map((f) =>
  parsePost(readFileSync(join(DIR, f), 'utf8'), f.replace(/\.md$/, '')),
);

/** The signup CTA. A call to action, not a page that explains the product. */
const SIGNUP = '/login?tab=register';

/** Targets the blog pages link to besides other posts. */
const ALLOWED_EXTERNAL_TARGETS = [SIGNUP];

/* ------------------------------------------------------------------------ *
 * Content rules.
 *
 * Every rule is a pure predicate so it can be pointed at a crafted violation
 * directly. A rule only ever exercised against the posts we already wrote is
 * untested: it passes because nothing challenges it, not because it works.
 * The fixtures at the bottom of this file are that challenge.
 * ------------------------------------------------------------------------ */

/** "R$ 49", "R$49", "R$  49" and "49 reais" are all a price. */
const MONEY = /R\$\s*\d|\b\d+(?:[.,]\d+)*\s*reais\b/i;

const MESAAS = /mesaas/i;

/** Rivals we name and compare against. */
const COMPETITOR = /aprova\s*post|mlabs|etus|doo\s*studio|postgrain|robopost/i;

/**
 * A line that *denies* a capability rather than claiming one. Saying "o Mesaas
 * não gera imagens com IA" is the honest boundary these articles are supposed
 * to draw — the rule exists to stop us claiming what we do not ship, so it
 * must not block us from stating plainly that we do not ship it.
 */
const DENIAL = /\b(n[ãa]o|nunca|sem)\b/i;

/**
 * First-person plural attribution ("publicamos no TikTok", "nosso plano").
 * These articles write about Mesaas in the first person and address the
 * reader as "você", so "we" never refers to the reader — it is as much a
 * claim about Mesaas as saying the name outright.
 *
 * Matched morphologically rather than by a verb list: every pt-BR first-person
 * plural ends in -amos/-emos/-imos, so `suportamos` and `temos` are caught
 * without anyone having to remember to add them. An enumerated list is always
 * one verb behind the writer. The lookahead drops the two common nouns that
 * share the ending ("ramos", "remos") — they are not conjugations.
 */
const FIRST_PERSON_MESAAS = /\b(?!(?:ramos|remos)\b)(?:\w+[aei]mos|nossos?|nossas?)\b/i;

/**
 * Money presented as the price of a Mesaas subscription tier — named
 * ("plano Pro"), first-person ("nosso plano de entrada") or superlative
 * ("o plano mais barato"). Prices change and plans are database rows, so the
 * article links to /precos instead of quoting a number.
 */
const MESAAS_PLAN_PRICE = new RegExp(
  [
    /(?:nosso|nossos|meu|meus)\s+planos?\b/.source,
    /plano\s+(?:free|start|pro|max|gratuito|gr[aá]tis|inicial|b[aá]sico)\b/.source,
    /plano\s+de\s+entrada\b/.source,
    /plano\s+mais\s+\p{L}+/.source,
    /planos?\s+d[oa]\s+(?:ferramenta|plataforma)\b/.source,
  ].join('|'),
  'iu',
);

/**
 * The reader pricing their own service to their own client ("um plano de 12
 * posts para o cliente"). That is the one legitimate way money shows up here,
 * so it is exempt — but only when our own name is absent from the line.
 */
const READERS_OWN_PRICING =
  /\b(?:para|pro|ao|do)\s+(?:o\s+)?cliente|seu\s+cliente|voc[êe]\s+(?:cobra|cobrar|vende|vender|fatura)/i;

function quotesMesaasPlanPrice(line: string): boolean {
  if (!MONEY.test(line)) return false;
  if (MESAAS.test(line)) return true; // our name next to a price is always wrong
  return MESAAS_PLAN_PRICE.test(line) && !READERS_OWN_PRICING.test(line);
}

/** Written with or without the space: "TikTok", "Tik Tok". */
const TIKTOK = /tik\s*tok/i;

// Note the singular: pt-BR is "imagem"/"imagens", so `imagens?` alone silently
// misses every singular phrasing ("gerar imagem com IA").
const IMAGE_NOUN = /(?:imagem|imagens|artes?|criativos?)/.source;
// Includes the first-person-plural conjugations ("geramos", "criamos",
// "produzimos"): "gera"/"cria" alone do not match inside them because \b
// does not break between two word characters ("a" and the following "m").
const MAKE_VERB =
  /(?:gera|geramos|gerar|gerando|gera[çc][ãa]o|cria|criamos|criar|criando|cria[çc][ãa]o|produzir|produzimos|produzindo|produ[çc][ãa]o)/
    .source;
const BY_AI = /(?:com|por|via|usando|atrav[ée]s\s+de)\s+(?:ia|intelig[êe]ncia\s+artificial)/.source;

/** "geração de imagens com IA", "gerar imagem por IA", "imagens geradas por IA". */
const AI_IMAGE = [
  // verb → noun → by AI
  new RegExp(
    `\\b${MAKE_VERB}\\b[^.\\n]{0,40}?\\b${IMAGE_NOUN}\\b[^.\\n]{0,25}?\\b${BY_AI}\\b`,
    'i',
  ),
  // noun → participle → by AI
  new RegExp(
    `\\b${IMAGE_NOUN}\\b[^.\\n]{0,25}?\\b(?:gerad|criad|produzid)[ao]s?\\b[^.\\n]{0,25}?\\b${BY_AI}\\b`,
    'i',
  ),
];

/**
 * Whether a claim reads as something *we* ship. Competitor-attributed claims
 * pass: refusing to describe a capability a rival genuinely has would make our
 * own comparison dishonest — and their TikTok support is exactly that case.
 * The line's own attribution wins, then the section heading it sits under;
 * an unattributed claim counts as ours, so the rule fails closed.
 */
function claimIsAboutMesaas(line: string, heading = ''): boolean {
  for (const scope of [line, heading]) {
    if (MESAAS.test(scope) || FIRST_PERSON_MESAAS.test(scope)) return true;
    if (COMPETITOR.test(scope)) return false;
  }
  return true;
}

/** Names the rules a line breaks by claiming something this repo does not ship. */
function unshippedClaims(line: string, heading = ''): string[] {
  if (!claimIsAboutMesaas(line, heading)) return [];
  if (DENIAL.test(line)) return [];
  const broken: string[] = [];
  if (TIKTOK.test(line)) broken.push('TikTok is not launched');
  if (AI_IMAGE.some((re) => re.test(line))) broken.push('there is no AI image generation');
  return broken;
}

/**
 * An HTML tag written into a post body. These posts render through
 * `react-markdown` with no `rehype-raw`, so raw HTML is escaped and shown to
 * the reader as literal text instead of markup — a silent breakage that looks
 * fine in the source. Autolinks (`<https://…>`) are not tags and stay legal.
 */
const RAW_HTML = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

interface BodyLine {
  line: string;
  heading: string;
  inLabelledExample: boolean;
}

/**
 * Walks a body once, tagging every line with the `##` section it sits under and
 * whether it is inside a blockquote that *opened* with "Exemplo". A blockquote
 * runs from its first `>` line until the first line that is not one, so a
 * labelled example covers its own continuation lines and nothing else.
 */
function walkBody(body: string): BodyLine[] {
  let heading = '';
  let inQuote = false;
  let labelled = false;
  return body.split('\n').map((line) => {
    if (/^\s*>/.test(line)) {
      if (!inQuote) {
        inQuote = true;
        labelled = /exemplo/i.test(line);
      }
    } else {
      inQuote = false;
      labelled = false;
      if (/^##\s/.test(line)) heading = line;
    }
    return { line, heading, inLabelledExample: inQuote && labelled };
  });
}

function internalHrefs(body: string): string[] {
  return [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
}

describe('blog content', () => {
  test('there is at least one post', () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  test('slugs are unique and kebab-case', () => {
    const slugs = posts.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test('bodies start their hierarchy at h2 (the page renders the only h1)', () => {
    for (const post of posts) {
      expect(post.body, `${post.slug}: body must not contain an h1`).not.toMatch(/^# /m);
      const h2s = post.body.match(/^## /gm) ?? [];
      expect(
        h2s.length,
        `${post.slug}: body needs at least two h2 sections`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  test('bodies contain no raw HTML', () => {
    for (const post of posts) {
      for (const line of post.body.split('\n')) {
        expect(
          RAW_HTML.test(line),
          `${post.slug}: raw HTML is rendered as literal text (react-markdown runs without rehype-raw) — use markdown (line: ${line.trim()})`,
        ).toBe(false);
      }
    }
  });

  test('internal links point at routes that exist', () => {
    const known = new Set([
      ...PUBLIC_ROUTES.map((r) => r.path),
      ...posts.map((p) => `/blog/${p.slug}`),
      ...ALLOWED_EXTERNAL_TARGETS,
    ]);
    for (const post of posts) {
      for (const href of internalHrefs(post.body)) {
        expect(known.has(href), `${post.slug}: dead internal link ${href}`).toBe(true);
      }
    }
  });

  test('every post links to at least one product page', () => {
    for (const post of posts) {
      const productPages = internalHrefs(post.body).filter(
        (href) => !href.startsWith('/blog/') && href !== SIGNUP,
      );
      expect(
        productPages,
        `${post.slug}: no internal product link (the signup CTA does not count as one)`,
      ).not.toHaveLength(0);
    }
  });

  test('money appears only inside labelled examples, never as a Mesaas plan price', () => {
    for (const post of posts) {
      for (const { line, inLabelledExample } of walkBody(post.body)) {
        if (!MONEY.test(line)) continue;
        expect(
          quotesMesaasPlanPrice(line),
          `${post.slug}: never quote Mesaas plan prices — link to /precos instead (line: ${line.trim()})`,
        ).toBe(false);
        expect(
          inLabelledExample,
          `${post.slug}: money outside a worked example — put it in a blockquote starting with "Exemplo:" (line: ${line.trim()})`,
        ).toBe(true);
      }
    }
  });

  test('no claims about features this repo does not ship', () => {
    for (const post of posts) {
      for (const { line, heading } of walkBody(post.body)) {
        const broken = unshippedClaims(line, heading);
        expect(broken, `${post.slug}: ${broken.join('; ')} (line: ${line.trim()})`).toEqual([]);
      }
    }
  });

  test('frontmatter obeys the body rules (it is copy too, and it reaches the SERP)', () => {
    for (const post of posts) {
      const fields: [string, string][] = [
        ['title', post.title],
        ['h1', post.h1],
        ['description', post.description],
      ];
      for (const [field, text] of fields) {
        expect(
          MONEY.test(text),
          `${post.slug}: money in ${field} — link to /precos instead (${text})`,
        ).toBe(false);
        const broken = unshippedClaims(text);
        expect(broken, `${post.slug}: ${field}: ${broken.join('; ')}`).toEqual([]);
      }
    }
  });
});

/* ------------------------------------------------------------------------ *
 * Adversarial fixtures: every rule above, shown rejecting a string built to
 * slip past it, and shown leaving legitimate copy alone.
 * ------------------------------------------------------------------------ */

describe('content lint rules', () => {
  describe('money detection', () => {
    test.each(['R$ 49', 'R$49', 'R$  49', 'sai por 49 reais', 'R$ 1.200', '1.200 reais'])(
      'reads %j as money',
      (s) => {
        expect(MONEY.test(s)).toBe(true);
      },
    );

    test.each(['12 posts por mês', 'em julho de 2026', 'sem número algum'])(
      'leaves %j alone',
      (s) => {
        expect(MONEY.test(s)).toBe(false);
      },
    );
  });

  describe('Mesaas plan prices', () => {
    test.each([
      'nosso plano de entrada custa R$ 49',
      'o plano mais barato sai por R$ 149',
      'o plano Pro sai por R$ 149',
      'o Mesaas custa R$  49 por mês',
      'o plano da ferramenta sai por 99 reais',
    ])('rejects %j', (s) => {
      expect(quotesMesaasPlanPrice(s)).toBe(true);
    });

    test.each([
      '> Exemplo: você vende um plano de 12 posts para o cliente por R$ 1.200.',
      '> Exemplo: cobrar R$ 300 por reels do cliente ainda dá margem.',
      'os limites de cada opção estão na página de planos',
    ])('allows %j', (s) => {
      expect(quotesMesaasPlanPrice(s)).toBe(false);
    });
  });

  describe('money is confined to a blockquote that opens with "Exemplo"', () => {
    const allowances = (body: string) =>
      walkBody(body)
        .filter((l) => MONEY.test(l.line))
        .map((l) => l.inLabelledExample);

    test('a labelled example is allowed', () => {
      expect(allowances('> Exemplo: R$ 1.200 no pacote mensal.')).toEqual([true]);
    });

    test('its continuation lines are covered too', () => {
      expect(allowances('> Exemplo: um pacote mensal.\n> São R$ 1.200 no total.')).toEqual([true]);
    });

    test('a blockquote that never says Exemplo does not launder a price', () => {
      expect(allowances('> Cobramos R$ 49 por post.')).toEqual([false]);
    });

    test('prose that merely contains the word "exemplo" is not an example', () => {
      expect(allowances('Veja o exemplo: são R$ 49 por post.')).toEqual([false]);
    });

    test('a later, unlabelled blockquote does not inherit the label', () => {
      expect(allowances('> Exemplo: algo.\n\nProsa no meio.\n\n> Agora são R$ 99.')).toEqual([
        false,
      ]);
    });
  });

  describe('unshipped-feature claims', () => {
    test.each([
      'O Mesaas publica no TikTok',
      'Publicamos no Tik Tok também',
      'agendamento no tiktok direto do kanban',
      'geração de imagem com IA',
      'gerar imagem com IA',
      'criação de imagens com IA',
      'imagens geradas por IA',
      'imagem gerada com IA',
      'arte criada por inteligência artificial',
      'artes criadas por inteligência artificial',
      'geração de imagens por IA',
      'o Mesaas gera as imagens do post usando IA',
    ])('rejects the unattributed or Mesaas-attributed claim %j', (s) => {
      expect(unshippedClaims(s)).not.toEqual([]);
    });

    test('allows a competitor-attributed TikTok mention on the same line', () => {
      expect(unshippedClaims('O Aprova Post aprova os formatos do TikTok e do Instagram.')).toEqual(
        [],
      );
    });

    // The rule exists to stop us claiming what we do not ship. Drawing the
    // boundary out loud — which is what the "o que o Mesaas não faz" sections
    // are for — is the honest use of the same words, and must stay writable.
    test.each([
      'O Mesaas não gera imagens com IA.',
      'O Mesaas não publica no TikTok.',
      'Não geramos imagens com IA: o agente escreve o texto e anexa a sua arte.',
      'O Mesaas é focado no Instagram, sem publicação no TikTok.',
      'Nunca publicamos no TikTok em seu nome.',
    ])('allows the honest denial %j', (s) => {
      expect(unshippedClaims(s)).toEqual([]);
    });

    test('treats Doo Studio as a competitor, so its capabilities are attributable', () => {
      expect(unshippedClaims('O Doo Studio aprova os formatos do TikTok.')).toEqual([]);
    });

    test.each([
      '- Também publicamos no TikTok.',
      '- Publicamos no TikTok e no Instagram.',
      'Diferente do Aprova Post, já publicamos no TikTok.',
      'Ao contrário do Aprova Post, geramos imagens com IA.',
    ])('rejects the first-person-plural claim %j even without the Mesaas name', (s) => {
      expect(unshippedClaims(s)).not.toEqual([]);
    });

    test('still allows a competitor-attributed TikTok mention with no first-person verb', () => {
      expect(unshippedClaims('Diferente de nós, o Aprova Post já publica no TikTok.')).toEqual([]);
    });

    test('allows a TikTok mention inside a competitor section', () => {
      expect(
        unshippedClaims('- Aprovação dos formatos do TikTok.', '## O que o Aprova Post entrega'),
      ).toEqual([]);
    });

    test('still rejects a Mesaas claim made inside a competitor section', () => {
      expect(
        unshippedClaims('O Mesaas também publica no TikTok.', '## O que o Aprova Post entrega'),
      ).not.toEqual([]);
    });

    test('leaves the AI content agent we do ship alone', () => {
      expect(
        unshippedClaims('Há um agente de conteúdo com IA que cria o rascunho por MCP.'),
      ).toEqual([]);
    });
  });

  describe('raw HTML', () => {
    test.each([
      '<a href="/precos">planos</a>',
      '<img src="x.png" />',
      'quebra<br>de linha',
      '<div class="x">',
    ])('rejects %j', (s) => {
      expect(RAW_HTML.test(s)).toBe(true);
    });

    test.each([
      '[planos](/precos)',
      'veja em <https://www.mesaas.com.br>',
      'quando a > b e a < c',
      '| Recurso | Mesaas |',
    ])('allows %j', (s) => {
      expect(RAW_HTML.test(s)).toBe(false);
    });
  });

  describe('product-page links', () => {
    const productPages = (body: string) =>
      internalHrefs(body).filter((href) => !href.startsWith('/blog/') && href !== SIGNUP);

    test('the signup CTA alone does not count as a product page', () => {
      expect(productPages('Depois é só [criar sua conta](/login?tab=register).')).toEqual([]);
    });

    test('a real product page counts', () => {
      expect(productPages('Veja a [aprovação de post](/aprovacao-de-post).')).toEqual([
        '/aprovacao-de-post',
      ]);
    });
  });
});
