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

import changelogData from '../changelog.json';

describe('changelog.json (committed data)', () => {
  it('always conforms to the schema — gates the auto-merge', () => {
    const result = changelogSchema.safeParse(changelogData);
    if (!result.success) console.error(result.error.format());
    expect(result.success).toBe(true);
  });
});

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
