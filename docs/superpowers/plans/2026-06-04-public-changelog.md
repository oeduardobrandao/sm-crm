# Public Changelog ("Novidades") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, auto-generated changelog at `/novidades` (crawlable, linked from the landing page and the in-app sidebar) that a weekly Claude routine fills from merged PRs and publishes hands-off via an auto-merging PR.

**Architecture:** Content is a single version-controlled `changelog.json` validated by a zod schema. Pure data-transform functions (cutoff/select/prepend) live under `apps/crm/src/content/` so existing Vitest + typecheck cover them; the agent's `gh`/IO glue lives in `scripts/changelog/` (typechecked via a new tsconfig). The page is a dependency-light React component (SSR-safe, like `LgpdPage`); a post-build script prerenders it to static HTML with SEO meta. A push-to-`main` GitHub Action emails via Resend on publish.

**Tech Stack:** React 19 + react-router v7, zod 4, Vitest + @testing-library/react, Node 20 scripts via `tsx`, GitHub Actions, Resend, Vercel.

**Spec:** `docs/superpowers/specs/2026-06-04-public-changelog-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/crm/src/content/changelog.schema.ts` | Zod schema, types, `parseReleases()` |
| Create | `apps/crm/src/content/changelog.logic.ts` | Pure: `cutoffDate`, `selectPRs`, `prependRelease`, `PullRequest` |
| Create | `apps/crm/src/content/changelog.seo.ts` | Pure: `renderChangelogHtml()` (escaped static HTML) |
| Create | `apps/crm/src/content/changelog.json` | The changelog data (source of truth) |
| Create | `apps/crm/src/content/__tests__/changelog.test.ts` | Unit tests for schema + logic + seo + data validity |
| Create | `apps/crm/src/pages/novidades/NovidadesPage.tsx` | Public page component |
| Create | `apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx` | Render test |
| Modify | `apps/crm/src/App.tsx` | Public `/novidades` route |
| Modify | `apps/crm/src/components/layout/nav-data.ts` | `Novidades` item in `Suporte` group |
| Modify | `apps/crm/src/pages/landing/LandingPage.tsx` | Footer link |
| Create | `scripts/changelog/fetch.ts` | gh fetch + `selectPRs` → JSON to stdout |
| Create | `scripts/changelog/apply.ts` | validate + `prependRelease` → write file |
| Create | `scripts/changelog/prerender.ts` | Build static `dist/novidades.html` + meta |
| Create | `scripts/changelog/notify-published.mjs` | Resend email from the published diff |
| Create | `scripts/changelog/runbook.md` | Weekly agent instructions |
| Create | `tsconfig.scripts.json` | Typecheck config for `scripts/` |
| Modify | `.github/workflows/ci.yml` | Typecheck `scripts/` step |
| Create | `.github/workflows/changelog-notify.yml` | Resend on publish |
| Create | `apps/crm/public/sitemap.xml`, `apps/crm/public/robots.txt` | SEO |
| Modify | `vercel.json` | Rewrite `/novidades` → prerendered HTML; build step |
| Modify | `package.json` | `prerender:novidades` script; add `tsx` dev dep |

**Convention note:** Vitest globals are on, but existing tests import `{ describe, it, expect }` from `vitest` explicitly — match that. Test files live in `__tests__/` and run via the existing `apps/**/__tests__/**/*.test.{ts,tsx}` include.

---

## Task 1: Changelog schema + types

**Files:**
- Create: `apps/crm/src/content/changelog.schema.ts`
- Test: `apps/crm/src/content/__tests__/changelog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/content/__tests__/changelog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { changelogSchema, parseReleases } from '../changelog.schema';

const VALID = {
  lastMergedAt: '2026-06-03T13:42:12Z',
  releases: [
    {
      date: '2026-06-03',
      summary: 'Resumo da semana.',
      items: [
        { type: 'feature', area: 'Entregas', title: 'Título', description: 'Descrição.', pr: 93 },
      ],
    },
  ],
};

describe('changelogSchema', () => {
  it('accepts a valid document', () => {
    expect(changelogSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].items[0].type = 'breaking';
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].date = '03/06/2026';
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a release with no items', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].items = [];
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseReleases', () => {
  it('returns releases for valid data', () => {
    expect(parseReleases(VALID)).toHaveLength(1);
  });

  it('returns [] for invalid data (page safety net)', () => {
    expect(parseReleases({ nope: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: FAIL — `Cannot find module '../changelog.schema'`.

- [ ] **Step 3: Implement the schema**

Create `apps/crm/src/content/changelog.schema.ts`:

```ts
import { z } from 'zod';

export const changelogItemSchema = z.object({
  type: z.enum(['feature', 'improvement', 'fix']),
  area: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  pr: z.number().int().positive(),
});

export const changelogReleaseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  summary: z.string().optional(),
  items: z.array(changelogItemSchema).min(1),
});

export const changelogSchema = z.object({
  // ISO 8601 UTC timestamp of the most recent PR merge evaluated, or '' when empty.
  lastMergedAt: z.string(),
  releases: z.array(changelogReleaseSchema),
});

export type ChangelogItem = z.infer<typeof changelogItemSchema>;
export type ChangelogRelease = z.infer<typeof changelogReleaseSchema>;
export type Changelog = z.infer<typeof changelogSchema>;

/** Page-safety parse: returns the releases array, or [] if the data is malformed. */
export function parseReleases(data: unknown): ChangelogRelease[] {
  const result = changelogSchema.safeParse(data);
  return result.success ? result.data.releases : [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/changelog.schema.ts apps/crm/src/content/__tests__/changelog.test.ts
git commit -m "feat(changelog): add zod schema, types, and parseReleases"
```

---

## Task 2: Pure logic — cutoff, select, prepend

**Files:**
- Create: `apps/crm/src/content/changelog.logic.ts`
- Test: `apps/crm/src/content/__tests__/changelog.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `apps/crm/src/content/__tests__/changelog.test.ts`:

```ts
import { cutoffDate, selectPRs, prependRelease, type PullRequest } from '../changelog.logic';
import type { Changelog } from '../changelog.schema';

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return { number: 1, title: 'feat: x', body: '', labels: [], mergedAt: '2026-06-02T10:00:00Z', ...over };
}

const EMPTY: Changelog = { lastMergedAt: '', releases: [] };

describe('cutoffDate', () => {
  it('uses the date part of lastMergedAt', () => {
    expect(cutoffDate({ ...EMPTY, lastMergedAt: '2026-06-03T13:42:12Z' }, '2000-01-01')).toBe('2026-06-03');
  });
  it('falls back when empty', () => {
    expect(cutoffDate(EMPTY, '2026-05-28')).toBe('2026-05-28');
  });
});

describe('selectPRs', () => {
  const base = { lastMergedAt: '2026-06-01T00:00:00Z', existingPrNumbers: [42] };

  it('keeps feat/fix/perf prefixes', () => {
    const out = selectPRs([pr({ number: 1, title: 'feat: a' }), pr({ number: 2, title: 'fix(x): b' }), pr({ number: 3, title: 'perf: c' })], base);
    expect(out.map(p => p.number)).toEqual([1, 2, 3]);
  });
  it('drops chore/ci/docs/style/refactor', () => {
    const out = selectPRs([pr({ number: 1, title: 'chore: a' }), pr({ number: 2, title: 'ci: b' }), pr({ number: 3, title: 'docs: c' })], base);
    expect(out).toEqual([]);
  });
  it('drops already-recorded PR numbers', () => {
    expect(selectPRs([pr({ number: 42, title: 'feat: a' })], base)).toEqual([]);
  });
  it('drops PRs at or before the watermark', () => {
    expect(selectPRs([pr({ number: 5, title: 'feat: a', mergedAt: '2026-05-30T00:00:00Z' })], base)).toEqual([]);
  });
  it('includes via opt-in label despite a non-matching prefix', () => {
    expect(selectPRs([pr({ number: 6, title: 'refactor: a', labels: ['changelog'] })], base).map(p => p.number)).toEqual([6]);
  });
  it('excludes via opt-out label despite a matching prefix', () => {
    expect(selectPRs([pr({ number: 7, title: 'feat: a', labels: ['no-changelog'] })], base)).toEqual([]);
  });
});

describe('prependRelease', () => {
  const release = { date: '2026-06-08', items: [{ type: 'feature' as const, area: 'A', title: 't', description: 'd', pr: 10 }] };

  it('prepends a new release and sets lastMergedAt', () => {
    const out = prependRelease(EMPTY, release, '2026-06-08T00:00:00Z');
    expect(out.releases).toHaveLength(1);
    expect(out.lastMergedAt).toBe('2026-06-08T00:00:00Z');
  });
  it('is idempotent — drops items whose pr already exists', () => {
    const seeded: Changelog = { lastMergedAt: 'x', releases: [{ date: '2026-06-01', items: [{ type: 'fix', area: 'A', title: 'old', description: 'd', pr: 10 }] }] };
    const out = prependRelease(seeded, release, '2026-06-08T00:00:00Z');
    expect(out.releases).toHaveLength(1); // no new block — item 10 was a duplicate
    expect(out.lastMergedAt).toBe('2026-06-08T00:00:00Z'); // watermark still advances
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: FAIL — `Cannot find module '../changelog.logic'`.

- [ ] **Step 3: Implement the logic**

Create `apps/crm/src/content/changelog.logic.ts`:

```ts
import type { Changelog, ChangelogRelease } from './changelog.schema';

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  labels: string[];
  mergedAt: string; // ISO 8601 UTC, e.g. "2026-06-03T13:42:12Z"
}

const INCLUDED_PREFIXES = ['feat', 'fix', 'perf'];
const OPT_IN_LABEL = 'changelog';
const OPT_OUT_LABEL = 'no-changelog';

/** Lower bound (YYYY-MM-DD) for the gh merged-PR search. */
export function cutoffDate(changelog: Changelog, fallbackDate: string): string {
  return changelog.lastMergedAt ? changelog.lastMergedAt.slice(0, 10) : fallbackDate;
}

function titlePrefix(title: string): string {
  const m = title.match(/^(\w+)(\([^)]*\))?!?:/);
  return m ? m[1].toLowerCase() : '';
}

/** Deterministic pre-LLM filter: dedup + prefix allowlist + label overrides. */
export function selectPRs(
  prs: PullRequest[],
  opts: { lastMergedAt: string; existingPrNumbers: number[] },
): PullRequest[] {
  const seen = new Set(opts.existingPrNumbers);
  return prs.filter((p) => {
    if (seen.has(p.number)) return false;
    if (opts.lastMergedAt && p.mergedAt <= opts.lastMergedAt) return false;
    if (p.labels.includes(OPT_OUT_LABEL)) return false;
    if (p.labels.includes(OPT_IN_LABEL)) return true;
    return INCLUDED_PREFIXES.includes(titlePrefix(p.title));
  });
}

/** Prepend a release (dedup items by pr) and advance the watermark. */
export function prependRelease(
  changelog: Changelog,
  release: ChangelogRelease,
  newLastMergedAt: string,
): Changelog {
  const existing = new Set(changelog.releases.flatMap((r) => r.items.map((i) => i.pr)));
  const items = release.items.filter((i) => !existing.has(i.pr));
  const releases = items.length ? [{ ...release, items }, ...changelog.releases] : changelog.releases;
  return { lastMergedAt: newLastMergedAt, releases };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: PASS (all logic + schema tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/changelog.logic.ts apps/crm/src/content/__tests__/changelog.test.ts
git commit -m "feat(changelog): add pure cutoff/select/prepend logic with tests"
```

---

## Task 3: Seed changelog.json + data-validity test

**Files:**
- Create: `apps/crm/src/content/changelog.json`
- Test: `apps/crm/src/content/__tests__/changelog.test.ts` (append)
- Verify: `apps/crm/tsconfig.json` has `resolveJsonModule`

- [ ] **Step 1: Append the failing test**

Append to `apps/crm/src/content/__tests__/changelog.test.ts`:

```ts
import changelogData from '../changelog.json';

describe('changelog.json (committed data)', () => {
  it('always conforms to the schema — gates the auto-merge', () => {
    const result = changelogSchema.safeParse(changelogData);
    if (!result.success) console.error(result.error.format());
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: FAIL — `Cannot find module '../changelog.json'`.

- [ ] **Step 3: Create the seed data**

Create `apps/crm/src/content/changelog.json` (initial real content so the page is not empty at launch; `lastMergedAt` is PR #93's merge time so the first weekly run starts after it):

```json
{
  "lastMergedAt": "2026-06-03T13:42:12Z",
  "releases": [
    {
      "date": "2026-06-03",
      "summary": "Datas de publicação na lista de posts e relatórios mensais repaginados.",
      "items": [
        {
          "type": "feature",
          "area": "Entregas",
          "title": "Veja a data de publicação direto na lista de posts",
          "description": "A lista de posts agora mostra quando cada post foi publicado, sem precisar abrir o card.",
          "pr": 93
        },
        {
          "type": "feature",
          "area": "Analytics",
          "title": "Relatório mensal do Instagram repaginado",
          "description": "O relatório mensal ganhou um novo visual, com layout mais limpo e exportação em PDF aprimorada.",
          "pr": 90
        },
        {
          "type": "improvement",
          "area": "Clientes",
          "title": "Cards de fluxo mais ricos no detalhe do cliente",
          "description": "A tela de detalhe do cliente agora traz cards de fluxo de trabalho com mais informação e um painel lateral rápido.",
          "pr": 89
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Ensure JSON imports typecheck**

Run: `grep -n "resolveJsonModule" apps/crm/tsconfig.json`
If absent, add `"resolveJsonModule": true` to `compilerOptions` in `apps/crm/tsconfig.json`.
Then run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/content/changelog.json apps/crm/src/content/__tests__/changelog.test.ts apps/crm/tsconfig.json
git commit -m "feat(changelog): seed changelog.json and validate it in CI"
```

---

## Task 4: SEO render function

**Files:**
- Create: `apps/crm/src/content/changelog.seo.ts`
- Test: `apps/crm/src/content/__tests__/changelog.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Append to `apps/crm/src/content/__tests__/changelog.test.ts`:

```ts
import { renderChangelogHtml } from '../changelog.seo';
import type { ChangelogRelease } from '../changelog.schema';

const releases: ChangelogRelease[] = [
  { date: '2026-06-03', summary: 'Resumo.', items: [
    { type: 'feature', area: 'Entregas', title: 'Novo recurso', description: 'Faz algo útil.', pr: 1 },
  ] },
];

describe('renderChangelogHtml', () => {
  it('includes the heading, dates, titles, and descriptions', () => {
    const html = renderChangelogHtml(releases);
    expect(html).toContain('<h1>Novidades</h1>');
    expect(html).toContain('2026-06-03');
    expect(html).toContain('Novo recurso');
    expect(html).toContain('Faz algo útil.');
  });
  it('escapes HTML in content (XSS safety)', () => {
    const html = renderChangelogHtml([
      { date: '2026-06-03', items: [{ type: 'fix', area: 'A', title: '<script>x</script>', description: 'a & b', pr: 2 }] },
    ]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
  it('renders an empty-state message when there are no releases', () => {
    expect(renderChangelogHtml([])).toContain('Em breve');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: FAIL — `Cannot find module '../changelog.seo'`.

- [ ] **Step 3: Implement the renderer**

Create `apps/crm/src/content/changelog.seo.ts`:

```ts
import type { ChangelogRelease } from './changelog.schema';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Minimal, escaped, semantic HTML for crawlers. Mirrors the page's text content. */
export function renderChangelogHtml(releases: ChangelogRelease[]): string {
  if (!releases.length) return '<h1>Novidades</h1><p>Em breve, novidades por aqui.</p>';
  const sections = releases
    .map((r) => {
      const items = r.items
        .map((i) => `<article><h3>${esc(i.title)}</h3><p>${esc(i.description)}</p></article>`)
        .join('');
      const summary = r.summary ? `<p>${esc(r.summary)}</p>` : '';
      return `<section><h2>${esc(r.date)}</h2>${summary}${items}</section>`;
    })
    .join('');
  return `<h1>Novidades</h1>${sections}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/content/__tests__/changelog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/content/changelog.seo.ts apps/crm/src/content/__tests__/changelog.test.ts
git commit -m "feat(changelog): add escaped SEO HTML renderer"
```

---

## Task 5: NovidadesPage component

**Files:**
- Create: `apps/crm/src/pages/novidades/NovidadesPage.tsx`
- Test: `apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx`

- [ ] **Step 1: Write the failing render test**

Create `apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NovidadesPage from '../NovidadesPage';
import type { ChangelogRelease } from '@/content/changelog.schema';

const releases: ChangelogRelease[] = [
  { date: '2026-06-03', summary: 'Resumo da semana.', items: [
    { type: 'feature', area: 'Entregas', title: 'Recurso A', description: 'Descrição A.', pr: 1 },
    { type: 'fix', area: 'Analytics', title: 'Correção B', description: 'Descrição B.', pr: 2 },
  ] },
];

describe('NovidadesPage', () => {
  it('renders titles, descriptions, and type badges', () => {
    render(<NovidadesPage releases={releases} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Novidades' })).toBeInTheDocument();
    expect(screen.getByText('Recurso A')).toBeInTheDocument();
    expect(screen.getByText('Descrição B.')).toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByText('Correção')).toBeInTheDocument();
  });

  it('shows an empty state when there are no releases', () => {
    render(<NovidadesPage releases={[]} />);
    expect(screen.getByText(/Em breve/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx`
Expected: FAIL — `Cannot find module '../NovidadesPage'`.

- [ ] **Step 3: Implement the page**

Create `apps/crm/src/pages/novidades/NovidadesPage.tsx` (dependency-light, SSR-safe — no AntD, plain anchors and CSS vars like `LgpdPage`):

```tsx
import changelogData from '@/content/changelog.json';
import { parseReleases, type ChangelogRelease } from '@/content/changelog.schema';

const TYPE_BADGE: Record<ChangelogRelease['items'][number]['type'], { label: string; color: string; bg: string }> = {
  feature: { label: 'Novo', color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)' },
  improvement: { label: 'Melhoria', color: '#42c8f5', bg: 'rgba(66,200,245,0.12)' },
  fix: { label: 'Correção', color: '#f5a342', bg: 'rgba(245,163,66,0.12)' },
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
}

export default function NovidadesPage({ releases }: { releases?: ChangelogRelease[] }) {
  const data = releases ?? parseReleases(changelogData);

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }} className="animate-up">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.5rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
          Novidades
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>
          O que há de novo no Mesaas. Atualizado toda semana.
        </p>
      </div>

      {data.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Em breve, novidades por aqui.</p>
      ) : (
        data.map((release) => (
          <div key={release.date} className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', color: 'var(--primary-color)' }}>
                {formatDate(release.date)}
              </h2>
              {release.summary && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.25rem' }}>{release.summary}</p>
              )}
            </div>

            {release.items.map((item) => {
              const badge = TYPE_BADGE[item.type];
              return (
                <div key={item.pr} style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: badge.color, background: badge.bg, padding: '0.2rem 0.5rem', borderRadius: 2 }}>
                      {badge.label}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {item.area}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.2rem' }}>
                    {item.title}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>{item.description}</p>
                </div>
              );
            })}
          </div>
        ))
      )}

      <p style={{ textAlign: 'center', marginTop: '2rem' }}>
        <a href="/" style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}>Voltar para o início</a>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/novidades/__tests__/NovidadesPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/novidades
git commit -m "feat(changelog): add public NovidadesPage component"
```

---

## Task 6: Wire route + sidebar item + landing link

**Files:**
- Modify: `apps/crm/src/App.tsx`
- Modify: `apps/crm/src/components/layout/nav-data.ts`
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx`

- [ ] **Step 1: Add the lazy import**

In `apps/crm/src/App.tsx`, under the `// Public pages` block (after the `LandingPage` import on line ~20), add:

```tsx
const NovidadesPage = lazy(() => import('./pages/novidades/NovidadesPage'));
```

- [ ] **Step 2: Add the public route**

In `apps/crm/src/App.tsx`, in the `{/* Public routes */}` block (after the `/lgpd` route, ~line 79), add:

```tsx
<Route path="/novidades" element={<NovidadesPage />} />
```

- [ ] **Step 3: Add the sidebar item**

In `apps/crm/src/components/layout/nav-data.ts`, change the `ajuda-group` items array to include Novidades:

```ts
  {
    id: 'ajuda-group', label: 'Suporte', labelKey: 'nav.suporte', icon: 'ph-lifebuoy', items: [
      { id: 'novidades', route: '/novidades', label: 'Novidades', labelKey: 'nav.novidades', icon: 'ph-sparkle' },
      { id: 'ajuda', route: '/ajuda', label: 'Ajuda', labelKey: 'nav.ajuda', icon: 'ph-question' },
    ]
  },
```

(The sidebar renders `t(item.labelKey, item.label)`, so the missing `nav.novidades` i18n key falls back to `Novidades` — no locale file change required.)

- [ ] **Step 4: Add the landing footer link**

In `apps/crm/src/pages/landing/LandingPage.tsx`, find the footer product column `<ul>` containing `<a href="#faq">FAQ</a>` (~line 752) and add a Novidades item next to it:

```tsx
<li><a href="/novidades">Novidades</a></li>
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed (route + page compile).

Run: `npm run test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/App.tsx apps/crm/src/components/layout/nav-data.ts apps/crm/src/pages/landing/LandingPage.tsx
git commit -m "feat(changelog): wire /novidades route, sidebar item, and landing link"
```

---

## Task 7: Prerender script + Vercel rewrite + sitemap

> This is the highest-risk task (it changes the Vercel build). The page already works without it; prerender is additive for SEO. Verify the build output locally before relying on it.

**Files:**
- Create: `scripts/changelog/prerender.ts`
- Create: `apps/crm/public/sitemap.xml`
- Create: `apps/crm/public/robots.txt`
- Modify: `vercel.json`
- Modify: `package.json`

- [ ] **Step 1: Add `tsx` and the prerender npm script**

Run: `npm install -D tsx`

In root `package.json` `scripts`, add:

```json
"prerender:novidades": "tsx scripts/changelog/prerender.ts",
```

- [ ] **Step 2: Write the prerender script**

Create `scripts/changelog/prerender.ts` (reuses the tested `renderChangelogHtml`; no React SSR needed):

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';

const SITE_URL = process.env.SITE_URL ?? 'https://app.mesaas.com.br'; // TODO: confirm prod domain
const DIST = 'dist/index.html';
const OUT = 'dist/novidades.html';

const raw = JSON.parse(readFileSync('apps/crm/src/content/changelog.json', 'utf8'));
const parsed = changelogSchema.safeParse(raw);
const releases = parsed.success ? parsed.data.releases : [];
const content = renderChangelogHtml(releases);

const meta = [
  `<title>Novidades — Mesaas</title>`,
  `<meta name="description" content="As novidades e funcionalidades mais recentes do Mesaas, atualizadas toda semana." />`,
  `<link rel="canonical" href="${SITE_URL}/novidades" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:title" content="Novidades — Mesaas" />`,
  `<meta property="og:description" content="Veja o que há de novo no Mesaas." />`,
  `<meta property="og:url" content="${SITE_URL}/novidades" />`,
].join('\n    ');

let html = readFileSync(DIST, 'utf8');
html = html.replace('<title>Mesaas - Gestão Inteligente</title>', '');
html = html.replace('</head>', `    ${meta}\n  </head>`);
html = html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);
writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${releases.length} release blocks)`);
```

- [ ] **Step 3: Verify the prerender locally**

Run: `npm run build && npm run prerender:novidades`
Expected: `Wrote dist/novidades.html (1 release blocks)`.

Run: `grep -c "Veja a data de publicação" dist/novidades.html`
Expected: `1` (changelog content is in the static HTML).

Run: `grep -c 'id="root">.*<' dist/novidades.html`
Expected: `1` (content injected into the root div, not left empty).

- [ ] **Step 4: Add the Vercel rewrite + build step**

In `vercel.json`, add this rewrite **before** the SPA catch-all (the `/((?!hub/...` rule), so it matches first:

```json
{
  "source": "/novidades",
  "destination": "/novidades.html"
},
```

And change `buildCommand` to run the prerender after the CRM build:

```json
"buildCommand": "npm run build && npm run prerender:novidades && npm run build:hub && npm run build:admin",
```

- [ ] **Step 5: Create the sitemap and robots**

Create `apps/crm/public/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://app.mesaas.com.br/</loc></url>
  <url><loc>https://app.mesaas.com.br/novidades</loc></url>
</urlset>
```

Create `apps/crm/public/robots.txt` (if one already exists, add the `Sitemap:` line instead):

```
User-agent: *
Allow: /novidades
Sitemap: https://app.mesaas.com.br/sitemap.xml
```

(Confirm the prod domain matches `SITE_URL`; update all three files together if it differs.)

- [ ] **Step 6: Verification note**

The durable typecheck for `scripts/` is wired in Task 8 (`tsconfig.scripts.json` + CI step). For this task, the successful `npm run prerender:novidades` run plus the `grep` assertions in Step 3 are the verification.

- [ ] **Step 7: Commit**

```bash
git add scripts/changelog/prerender.ts vercel.json package.json package-lock.json apps/crm/public/sitemap.xml apps/crm/public/robots.txt
git commit -m "feat(changelog): prerender /novidades to static HTML with SEO meta"
```

---

## Task 8: Generator helper scripts + typecheck wiring + runbook

**Files:**
- Create: `scripts/changelog/fetch.ts`
- Create: `scripts/changelog/apply.ts`
- Create: `scripts/changelog/runbook.md`
- Create: `tsconfig.scripts.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the fetch helper**

Create `scripts/changelog/fetch.ts` (runs `gh`, applies the deterministic select, prints JSON for the agent):

```ts
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { cutoffDate, selectPRs, type PullRequest } from '../../apps/crm/src/content/changelog.logic';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

const CHANGELOG = 'apps/crm/src/content/changelog.json';
const changelog = changelogSchema.parse(JSON.parse(readFileSync(CHANGELOG, 'utf8')));
const cutoff = cutoffDate(changelog, daysAgo(7));

const raw = execFileSync(
  'gh',
  ['pr', 'list', '--state', 'merged', '--base', 'main', '--search', `merged:>=${cutoff}`, '--limit', '100',
   '--json', 'number,title,body,labels,mergedAt'],
  { encoding: 'utf8' },
);

const prs: PullRequest[] = JSON.parse(raw).map((p: any) => ({
  number: p.number,
  title: p.title,
  body: p.body ?? '',
  labels: (p.labels ?? []).map((l: any) => l.name),
  mergedAt: p.mergedAt,
}));

const existingPrNumbers = changelog.releases.flatMap((r) => r.items.map((i) => i.pr));
const selected = selectPRs(prs, { lastMergedAt: changelog.lastMergedAt, existingPrNumbers });
const batchMaxMergedAt = selected.reduce((max, p) => (p.mergedAt > max ? p.mergedAt : max), changelog.lastMergedAt);

console.log(JSON.stringify({ selected, batchMaxMergedAt, previousLastMergedAt: changelog.lastMergedAt }, null, 2));
```

- [ ] **Step 2: Write the apply helper**

Create `scripts/changelog/apply.ts` (validates the agent-written release and writes the file; handles the watermark-only case):

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { changelogSchema, changelogReleaseSchema } from '../../apps/crm/src/content/changelog.schema';
import { prependRelease } from '../../apps/crm/src/content/changelog.logic';

// Input JSON shape: { batchMaxMergedAt: string, release?: { date, summary?, items[] } }
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: tsx scripts/changelog/apply.ts <entries.json>');
  process.exit(1);
}

const CHANGELOG = 'apps/crm/src/content/changelog.json';
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const changelog = changelogSchema.parse(JSON.parse(readFileSync(CHANGELOG, 'utf8')));

let next;
if (input.release && Array.isArray(input.release.items) && input.release.items.length) {
  const release = changelogReleaseSchema.parse(input.release);
  next = prependRelease(changelog, release, input.batchMaxMergedAt);
} else {
  next = { ...changelog, lastMergedAt: input.batchMaxMergedAt }; // watermark-only update
}

changelogSchema.parse(next); // final validation before writing
writeFileSync(CHANGELOG, JSON.stringify(next, null, 2) + '\n');
console.log(`changelog.json updated (lastMergedAt=${next.lastMergedAt}, releases=${next.releases.length})`);
```

- [ ] **Step 3: Write the agent runbook**

Create `scripts/changelog/runbook.md`:

````markdown
# Weekly Changelog Runbook

You are generating the public changelog for Mesaas. Work on a fresh branch off `main`.

1. Fetch candidate PRs (deterministic select is already applied):
   ```bash
   npx tsx scripts/changelog/fetch.ts > /tmp/changelog-fetch.json
   ```
   Read `/tmp/changelog-fetch.json`: `selected` is the PRs to write up; `batchMaxMergedAt`
   is the new watermark.

2. If `selected` is empty, STOP — do nothing, open no PR.

3. For each PR in `selected`, write one entry aimed at customers (NOT raw commit text):
   - `type`: `feature` (new capability), `improvement` (better/faster existing thing —
     `perf`/`refactor`-with-user-impact usually map here), or `fix` (bug fix users noticed).
   - `area`: product area in Portuguese (Entregas, Analytics, Clientes, Hub, …).
   - `title` + `description`: friendly Brazilian Portuguese, benefit-oriented, no filenames,
     no internal jargon, no security-sensitive details.
   - Drop fixes a customer would not notice. If you drop ALL of them, still proceed to step 5
     with `release` omitted so the watermark advances.

4. Self-review every entry: accurate to the PR? plain language? not a duplicate of an entry
   already in `apps/crm/src/content/changelog.json`?

5. Write `/tmp/changelog-entries.json`:
   ```json
   {
     "batchMaxMergedAt": "<copy from fetch output>",
     "release": { "date": "<today YYYY-MM-DD>", "summary": "<1 line, optional>", "items": [ ... ] }
   }
   ```
   Omit `release` entirely if every PR was dropped.

6. Apply, then verify locally:
   ```bash
   npx tsx scripts/changelog/apply.ts /tmp/changelog-entries.json
   npx vitest run apps/crm/src/content/__tests__/changelog.test.ts
   ```

7. Open an auto-merging PR (CI gates it; no human review):
   ```bash
   git switch -c chore/changelog-$(date +%F)
   git add apps/crm/src/content/changelog.json
   git commit -m "chore(changelog): weekly update"
   gh pr create --base main --title "chore(changelog): weekly update" --body "Automated weekly changelog."
   gh pr merge --auto --squash
   ```
````

- [ ] **Step 4: Add the typecheck config**

Create `tsconfig.scripts.json`:

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
    "types": ["node"]
  },
  "include": ["scripts/**/*.ts"]
}
```

- [ ] **Step 5: Verify the scripts typecheck**

Run: `npx tsc -p tsconfig.scripts.json`
Expected: no errors.

- [ ] **Step 6: Add the CI typecheck step**

In `.github/workflows/ci.yml`, after the `Typecheck Admin` step, add:

```yaml
      - name: Typecheck scripts
        run: npx tsc -p tsconfig.scripts.json
```

- [ ] **Step 7: Commit**

```bash
git add scripts/changelog/fetch.ts scripts/changelog/apply.ts scripts/changelog/runbook.md tsconfig.scripts.json .github/workflows/ci.yml
git commit -m "feat(changelog): add generator helpers, runbook, and scripts typecheck"
```

---

## Task 9: Publish notification GitHub Action

**Files:**
- Create: `scripts/changelog/notify-published.mjs`
- Create: `.github/workflows/changelog-notify.yml`

**Prerequisite (manual, one-time):** add `RESEND_API_KEY` and `ALERT_EMAIL` as **GitHub repo secrets** (Settings → Secrets and variables → Actions). The values already exist in Supabase env but are not visible to Actions.

- [ ] **Step 1: Write the notification script**

Create `scripts/changelog/notify-published.mjs` (plain Node — no `tsx` needed):

```js
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATH = 'apps/crm/src/content/changelog.json';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const SITE_URL = process.env.SITE_URL ?? 'https://app.mesaas.com.br';

if (!RESEND_API_KEY || !ALERT_EMAIL) {
  console.log('Missing RESEND_API_KEY/ALERT_EMAIL; skipping.');
  process.exit(0);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

function load(ref) {
  try {
    return JSON.parse(execSync(`git show ${ref}:${PATH}`, { encoding: 'utf8' }));
  } catch {
    return { releases: [] };
  }
}

const before = load('HEAD~1');
const after = JSON.parse(readFileSync(PATH, 'utf8'));
const beforePrs = new Set(before.releases.flatMap((r) => r.items.map((i) => i.pr)));
const newItems = after.releases.flatMap((r) => r.items).filter((i) => !beforePrs.has(i.pr));

if (!newItems.length) {
  console.log('No new entries; skipping.');
  process.exit(0);
}

const list = newItems.map((i) => `<li><strong>${esc(i.title)}</strong> — ${esc(i.description)}</li>`).join('');
const html = `Novas entradas publicadas no changelog:<br><ul>${list}</ul><br>` +
  `<a href="${SITE_URL}/novidades">Ver Novidades</a>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Mesaas Alerts <alertas@mesaas.com.br>',
    to: [ALERT_EMAIL],
    subject: `[Mesaas] ${newItems.length} novidade(s) publicada(s)`,
    html,
  }),
});

if (!res.ok) {
  console.error('Resend error:', res.status, await res.text());
  process.exit(1);
}
console.log(`Notification sent for ${newItems.length} entr(y/ies).`);
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/changelog-notify.yml`:

```yaml
name: Changelog Notify

on:
  push:
    branches: [main]
    paths: ['apps/crm/src/content/changelog.json']

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Send Resend notification
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          ALERT_EMAIL: ${{ secrets.ALERT_EMAIL }}
        run: node scripts/changelog/notify-published.mjs
```

- [ ] **Step 3: Dry-run the script logic locally**

Run (simulates a publish by diffing the last two commits of the file; safe — secrets unset, so it exits early):

```bash
node scripts/changelog/notify-published.mjs
```
Expected: `Missing RESEND_API_KEY/ALERT_EMAIL; skipping.` (confirms it runs without crashing).

- [ ] **Step 4: Commit**

```bash
git add scripts/changelog/notify-published.mjs .github/workflows/changelog-notify.yml
git commit -m "feat(changelog): email via Resend on publish (push-to-main Action)"
```

---

## Task 10: Stand up the weekly schedule

This runs the generation routine (no code — it is harness/ops setup). Do this last, after the PR with Tasks 1–9 is merged to `main`, so the routine runs against the real `main`.

- [ ] **Step 1: Create the weekly routine**

Use the `schedule` skill (or `/schedule`) to create a weekly scheduled remote agent whose prompt is:

> Run the Mesaas weekly changelog routine by following `scripts/changelog/runbook.md` exactly, working in the `oeduardobrandao/sm-crm` repo on a fresh branch off `main`.

Suggested cadence: weekly, e.g. Mondays 13:00 (America/Fortaleza). Confirm the routine has repo + `gh` access.

- [ ] **Step 2: Verify with a manual run**

Trigger the routine once manually (or run the runbook steps yourself). Confirm: a `chore/changelog-<date>` PR is opened, CI passes, it auto-merges, `/novidades` updates after deploy, and the Resend email arrives.

- [ ] **Step 3: Record the routine**

Note the routine ID / schedule in the project memory or team docs so it can be paused/edited later. No commit required.

---

## Self-Review

- **Spec coverage:** schema+page-safety (T1), pure logic incl. watermark/dedup (T2), seed+CI validation (T3), SEO renderer (T4), page (T5), route+nav+landing (T6), prerender+Vercel+sitemap for real SEO (T7), generator helpers+runbook+scripts typecheck in CI (T8), Resend notify Action with secrets (T9), weekly schedule (T10). All spec sections map to a task.
- **Auto-publish/CI gate:** the runbook opens an auto-merging PR (T8 step 7); CI runs the schema-validation test (T3) and scripts typecheck (T8) before merge.
- **No placeholders:** every code step contains complete code. The one `TODO` is the prod-domain constant (`SITE_URL`), flagged for confirmation in T7 — a config value, not a code gap.
- **Type consistency:** `PullRequest`, `Changelog`, `ChangelogRelease`, `cutoffDate`, `selectPRs(prs, {lastMergedAt, existingPrNumbers})`, `prependRelease(changelog, release, newLastMergedAt)`, `parseReleases`, and `renderChangelogHtml` are used identically across tasks.
- **Open risk:** T7 (prerender + Vercel rewrite) is the most failure-prone; it is isolated and the page degrades gracefully (works, just not crawled) if it regresses.
```
