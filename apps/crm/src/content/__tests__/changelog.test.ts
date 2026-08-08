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

  it('accepts optional image and link on an item', () => {
    const doc = structuredClone(VALID) as any;
    doc.releases[0].items[0].image = '/novidades/pr-93.png';
    doc.releases[0].items[0].link = { href: '/entregas', label: 'Abrir Entregas' };
    expect(changelogSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects images outside /novidades/ and non-internal link hrefs', () => {
    const badImage = structuredClone(VALID) as any;
    badImage.releases[0].items[0].image = '/logo-black.svg';
    expect(changelogSchema.safeParse(badImage).success).toBe(false);

    for (const href of [
      'https://evil.example',
      'javascript:alert(1)',
      '//evil.example',
      '/a?q=1',
    ]) {
      const badLink = structuredClone(VALID) as any;
      badLink.releases[0].items[0].link = { href, label: 'x' };
      expect(changelogSchema.safeParse(badLink).success, href).toBe(false);
    }
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

import {
  cutoffDate,
  selectPRs,
  prependRelease,
  prependReleases,
  groupByWeek,
  sanitizeItems,
  scrubDashes,
  LINK_CATALOG,
  type PullRequest,
} from '../changelog.logic';
import type { Changelog } from '../changelog.schema';

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'feat: x',
    body: '',
    labels: [],
    mergedAt: '2026-06-02T10:00:00Z',
    ...over,
  };
}

const EMPTY: Changelog = { lastMergedAt: '', releases: [] };

describe('cutoffDate', () => {
  it('uses the date part of lastMergedAt', () => {
    expect(cutoffDate({ ...EMPTY, lastMergedAt: '2026-06-03T13:42:12Z' }, '2000-01-01')).toBe(
      '2026-06-03',
    );
  });
  it('falls back when empty', () => {
    expect(cutoffDate(EMPTY, '2026-05-28')).toBe('2026-05-28');
  });
});

describe('selectPRs', () => {
  const base = { lastMergedAt: '2026-06-01T00:00:00Z', existingPrNumbers: [42] };

  it('keeps feat/fix/perf prefixes', () => {
    const out = selectPRs(
      [
        pr({ number: 1, title: 'feat: a' }),
        pr({ number: 2, title: 'fix(x): b' }),
        pr({ number: 3, title: 'perf: c' }),
      ],
      base,
    );
    expect(out.map((p) => p.number)).toEqual([1, 2, 3]);
  });
  it('drops chore/ci/docs/style/refactor', () => {
    const out = selectPRs(
      [
        pr({ number: 1, title: 'chore: a' }),
        pr({ number: 2, title: 'ci: b' }),
        pr({ number: 3, title: 'docs: c' }),
      ],
      base,
    );
    expect(out).toEqual([]);
  });
  it('drops already-recorded PR numbers', () => {
    expect(selectPRs([pr({ number: 42, title: 'feat: a' })], base)).toEqual([]);
  });
  it('drops PRs at or before the watermark', () => {
    expect(
      selectPRs([pr({ number: 5, title: 'feat: a', mergedAt: '2026-05-30T00:00:00Z' })], base),
    ).toEqual([]);
  });
  it('includes via opt-in label despite a non-matching prefix', () => {
    expect(
      selectPRs([pr({ number: 6, title: 'refactor: a', labels: ['changelog'] })], base).map(
        (p) => p.number,
      ),
    ).toEqual([6]);
  });
  it('excludes via opt-out label despite a matching prefix', () => {
    expect(
      selectPRs([pr({ number: 7, title: 'feat: a', labels: ['no-changelog'] })], base),
    ).toEqual([]);
  });
  it('drops admin-scoped titles (platform-admin work is never customer-visible)', () => {
    expect(selectPRs([pr({ number: 8, title: 'feat(admin): trials KPI' })], base)).toEqual([]);
    expect(selectPRs([pr({ number: 9, title: 'fix(admin)!: comp control' })], base)).toEqual([]);
  });
  it('keeps an admin-scoped PR when explicitly opted in via label', () => {
    expect(
      selectPRs([pr({ number: 10, title: 'feat(admin): x', labels: ['changelog'] })], base).map(
        (p) => p.number,
      ),
    ).toEqual([10]);
  });
});

describe('prependRelease', () => {
  const release = {
    date: '2026-06-08',
    items: [{ type: 'feature' as const, area: 'A', title: 't', description: 'd', pr: 10 }],
  };

  it('prepends a new release and sets lastMergedAt', () => {
    const out = prependRelease(EMPTY, release, '2026-06-08T00:00:00Z');
    expect(out.releases).toHaveLength(1);
    expect(out.lastMergedAt).toBe('2026-06-08T00:00:00Z');
  });
  it('is idempotent — drops items whose pr already exists', () => {
    const seeded: Changelog = {
      lastMergedAt: 'x',
      releases: [
        {
          date: '2026-06-01',
          items: [{ type: 'fix', area: 'A', title: 'old', description: 'd', pr: 10 }],
        },
      ],
    };
    const out = prependRelease(seeded, release, '2026-06-08T00:00:00Z');
    expect(out.releases).toHaveLength(1); // no new block — item 10 was a duplicate
    expect(out.lastMergedAt).toBe('2026-06-08T00:00:00Z'); // watermark still advances
  });
});

describe('groupByWeek', () => {
  it('groups by ISO week (Mon-Sun), oldest first, dating each group by its last merge', () => {
    const groups = groupByWeek([
      pr({ number: 1, mergedAt: '2026-07-20T10:00:00Z' }), // Mon, week of 07-20
      pr({ number: 2, mergedAt: '2026-07-12T10:00:00Z' }), // Sun, week of 07-06
      pr({ number: 3, mergedAt: '2026-07-08T10:00:00Z' }), // Wed, week of 07-06
      pr({ number: 4, mergedAt: '2026-07-26T10:00:00Z' }), // Sun, week of 07-20
    ]);
    expect(groups.map((g) => g.prs.map((p) => p.number))).toEqual([
      [2, 3],
      [1, 4],
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-07-12', '2026-07-26']);
  });

  it('returns [] for no PRs', () => {
    expect(groupByWeek([])).toEqual([]);
  });
});

describe('scrubDashes', () => {
  it('turns spaced em/en dashes into a colon (or comma mid-sentence)', () => {
    expect(scrubDashes('Entregas — novo quadro')).toBe('Entregas: novo quadro');
    expect(scrubDashes('Agora é possível — sem etapas', true)).toBe('Agora é possível, sem etapas');
    expect(scrubDashes('intervalo 10–20')).toBe('intervalo 10-20');
  });
});

describe('sanitizeItems', () => {
  const opts = { allowedPrNumbers: [10, 11, 12], existingPrNumbers: [99] };

  it('coerces type synonyms and defaults unknown types to improvement', () => {
    const out = sanitizeItems(
      [
        { type: 'FEAT', area: 'A', title: 't', description: 'd', pr: 10 },
        { type: 'bugfix', area: 'A', title: 't', description: 'd', pr: 11 },
        { type: 'breaking', area: 'A', title: 't', description: 'd', pr: 12 },
      ],
      opts,
    );
    expect(out.map((i) => i.type)).toEqual(['feature', 'fix', 'improvement']);
  });

  it('drops hallucinated and already-published PR numbers, and malformed items', () => {
    const out = sanitizeItems(
      [
        { type: 'feature', area: 'A', title: 't', description: 'd', pr: 555 }, // not offered
        { type: 'feature', area: 'A', title: 't', description: 'd', pr: 99 }, // published
        { type: 'feature', area: '', title: 't', description: 'd', pr: 10 }, // empty area
        'garbage',
        { type: 'feature', area: 'A', title: 't', description: 'd', pr: 11 },
        { type: 'fix', area: 'A', title: 'dup', description: 'd', pr: 11 }, // dup in batch
      ],
      opts,
    );
    expect(out.map((i) => i.pr)).toEqual([11]);
  });

  it('resolves links against the catalog (href only, our label) and drops unknown routes', () => {
    const out = sanitizeItems(
      [
        { type: 'feature', area: 'A', title: 't', description: 'd', pr: 10, link: '/entregas' },
        { type: 'feature', area: 'A', title: 't', description: 'd', pr: 11, link: '/evil' },
        {
          type: 'feature',
          area: 'A',
          title: 't',
          description: 'd',
          pr: 12,
          link: { href: '/precos', label: 'Label do modelo' },
        },
      ],
      opts,
    );
    expect(out[0].link).toEqual({ href: '/entregas', label: 'Abrir Entregas' });
    expect(out[1].link).toBeUndefined();
    expect(out[2].link).toEqual({ href: '/precos', label: 'Ver planos' });
  });

  it('scrubs em dashes out of the copy', () => {
    const out = sanitizeItems(
      [
        {
          type: 'fix',
          area: 'A',
          title: 'Quadro — melhor',
          description: 'Mais rápido — sem recarregar',
          pr: 10,
        },
      ],
      opts,
    );
    expect(out[0].title).toBe('Quadro: melhor');
    expect(out[0].description).toBe('Mais rápido, sem recarregar');
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeItems({ items: [] }, opts)).toEqual([]);
  });
});

describe('prependReleases', () => {
  it('prepends multiple releases newest-first and advances the watermark once', () => {
    const out = prependReleases(
      EMPTY,
      [
        {
          date: '2026-07-26',
          items: [{ type: 'fix' as const, area: 'A', title: 'b', description: 'd', pr: 2 }],
        },
        {
          date: '2026-07-12',
          items: [{ type: 'feature' as const, area: 'A', title: 'a', description: 'd', pr: 1 }],
        },
      ],
      '2026-07-26T10:00:00Z',
    );
    expect(out.releases.map((r) => r.date)).toEqual(['2026-07-26', '2026-07-12']);
    expect(out.lastMergedAt).toBe('2026-07-26T10:00:00Z');
  });

  it('advances the watermark even when every release dedups away', () => {
    const seeded = prependReleases(
      EMPTY,
      [
        {
          date: '2026-07-12',
          items: [{ type: 'fix' as const, area: 'A', title: 'a', description: 'd', pr: 1 }],
        },
      ],
      '2026-07-12T00:00:00Z',
    );
    const out = prependReleases(
      seeded,
      [
        {
          date: '2026-07-26',
          items: [{ type: 'fix' as const, area: 'A', title: 'a', description: 'd', pr: 1 }],
        },
      ],
      '2026-07-26T00:00:00Z',
    );
    expect(out.releases).toHaveLength(1);
    expect(out.lastMergedAt).toBe('2026-07-26T00:00:00Z');
  });
});

describe('LINK_CATALOG', () => {
  it('only contains hrefs the schema accepts', () => {
    for (const { href, label } of LINK_CATALOG) {
      expect(
        changelogSchema.safeParse({
          lastMergedAt: '',
          releases: [
            {
              date: '2026-01-01',
              items: [
                {
                  type: 'feature',
                  area: 'A',
                  title: 't',
                  description: 'd',
                  pr: 1,
                  link: { href, label },
                },
              ],
            },
          ],
        }).success,
        href,
      ).toBe(true);
    }
  });
});

import changelogData from '../changelog.json';

describe('changelog.json (committed data)', () => {
  it('always conforms to the schema — gates the auto-merge', () => {
    const result = changelogSchema.safeParse(changelogData);
    if (!result.success) console.error(result.error.format());
    expect(result.success).toBe(true);
  });

  it('contains no em/en dashes in user-facing copy', () => {
    expect(JSON.stringify(changelogData)).not.toMatch(/[—–]/);
  });
});

import { renderChangelogHtml } from '../changelog.seo';
import type { ChangelogRelease } from '../changelog.schema';

const releases: ChangelogRelease[] = [
  {
    date: '2026-06-03',
    summary: 'Resumo.',
    items: [
      {
        type: 'feature',
        area: 'Entregas',
        title: 'Novo recurso',
        description: 'Faz algo útil.',
        pr: 1,
      },
    ],
  },
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
      {
        date: '2026-06-03',
        items: [
          { type: 'fix', area: 'A', title: '<script>x</script>', description: 'a & b', pr: 2 },
        ],
      },
    ]);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
  it('renders an empty-state message when there are no releases', () => {
    expect(renderChangelogHtml([])).toContain('Em breve');
  });

  it('renders item images and links, escaped', () => {
    const html = renderChangelogHtml([
      {
        date: '2026-08-08',
        items: [
          {
            type: 'feature',
            area: 'A',
            title: 'Com "extras"',
            description: 'd',
            pr: 3,
            image: '/novidades/pr-3.png',
            link: { href: '/entregas', label: 'Abrir Entregas' },
          },
        ],
      },
    ]);
    expect(html).toContain('<img src="/novidades/pr-3.png" alt="Com &quot;extras&quot;"');
    expect(html).toContain('<a href="/entregas">Abrir Entregas</a>');
  });
});
