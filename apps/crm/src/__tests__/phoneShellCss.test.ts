import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { matchesQuery, type MediaEnv } from '../test/mediaQueryMatcher';
import {
  collectTokens,
  makeIsPublicClass,
  parse,
  publicTokens,
  requiredClasses,
  ROOT,
  SRC,
  type PublicTokens,
} from '../test/publicCssClasses';

/**
 * The CSS half of the phone shell (lib/phoneShell.ts): touch tablets get the phone shell, so CRM
 * phone rules must reach them and desktop-only shell rules must not.
 *
 * Every `@media` block with a width or height feature is evaluated (semantically, through
 * `matchesQuery`) under five devices: a phone, a touch tablet in both orientations, a desktop and
 * a narrow desktop window. Its selectors are split into public ones (every required class is used
 * by public code, the same set cssSplitBoundary.test.ts computes, or no class at all) and shell
 * ones. Public pages keep their width-only behavior, so only shell selectors are checked.
 *
 * When this fails:
 * - a desktop range reaches a tablet: use `desktopShellQuery(min, { maxWidth?, screen? })` from
 *   lib/phoneShell.ts (repeat any extra feature, like `prefers-reduced-motion`, on every branch);
 * - a phone rule misses the tablet: use `PHONE_SHELL_QUERY`, or add `, (hover: none) and
 *   (pointer: coarse)` to a wider range (900px, 1100px). If phone markup does not rely on the
 *   rule (narrow-desktop or narrow-phone compaction), list it in REVIEWED_WIDTH_BLOCKS instead;
 * - a block mixes public and shell selectors: split it, the public copy keeping the old prelude.
 */

const CSS_GUARD_FILES = ['apps/crm/style.css', 'apps/crm/app.css'];

const env = (width: number, height: number, touch: boolean): MediaEnv => ({
  width,
  height,
  hover: touch ? 'none' : 'hover',
  pointer: touch ? 'coarse' : 'fine',
  media: 'screen',
});
const P = env(390, 844, true);
const T = env(1180, 820, true);
const Tp = env(820, 1180, true);
const D = env(1440, 900, false);
const N = env(800, 900, false);
// Rule (a) only: a 13" iPad in landscape and a mid-size laptop, so the 1280px ranges are caught.
const TL = env(1366, 1024, true);
const M = env(1200, 900, false);

/**
 * Names the public class set counts only because the word shows up in public code as something
 * else, while no public page renders them as a class or id. Selectors naming one are shell.
 */
const SHELL_ONLY: Record<string, string> = {
  '.main-content': 'public pages only use `main-content` as an id (skip link target)',
  '.sidebar': 'public code only names it in a querySelector string (lib/supabase.ts)',
  '#posts-table': 'the Instagram posts table (AnalyticsContaPage), styled with .data-table',
};

/**
 * Shell blocks a phone matches and a touch tablet does not, on purpose. Key: `<prelude> | <first
 * selector>`. Value: why phone markup does not need the rule on a tablet.
 */
const COMPACT = 'narrow-phone compaction; the tablet column is 680px wide';
const REVIEWED_WIDTH_BLOCKS: Record<string, string> = {
  '(max-width: 640px) | .today-row-who': COMPACT,
  '(max-width: 600px) | .calendar-weekdays': COMPACT,
  '(max-width: 640px) | .tarefa-list-row .board-card-deadline': COMPACT,
  '(max-width: 640px) | .hub-briefing__row': COMPACT,
  '(max-width: 600px) | .instagram-overview__profile': COMPACT,
  '(max-width: 640px) | .trial-nudge': COMPACT,
};

/**
 * Selectors that could match Hub markup (every required class appears in Hub code) inside a block
 * that now matches a touch tablet. The Hub imports both CRM stylesheets. Key: the selector.
 * NOT_IN_HUB: the Hub word is an id, key or i18n string (`post-${id}`, `${id}-panel`,
 * `hub-${id}`, 'sidebar.*'), checked by grep.
 */
const NOT_IN_HUB = 'the Hub never renders this class; only an id, key or i18n string matches';
const CRM_SHELL =
  'needs .app-container, .mobile-nav-glass or #posts-table, which the Hub never renders';
const HUB_REVIEWED_SELECTORS: Record<string, string> = {
  '.sidebar': NOT_IN_HUB,
  '.mobile-nav-items': NOT_IN_HUB,
  '.post-editor-link-input': NOT_IN_HUB,
  '.scheduled-panel': NOT_IN_HUB,
  '.drawer-panel': NOT_IN_HUB,
  '.calendar-detail-panel': NOT_IN_HUB,
  '.post-card-meta': NOT_IN_HUB,
  '.post-card-dash': NOT_IN_HUB,
  '.post-card-time': NOT_IN_HUB,
  '.post-card-lock': NOT_IN_HUB,
  '.hub-acesso__grid': NOT_IN_HUB,
  '.hub-briefing__shell': NOT_IN_HUB,
  '.hub-paginas__split': NOT_IN_HUB,
  '.hub-access__secondary-actions': NOT_IN_HUB,
  '.hub-access__primary-actions': NOT_IN_HUB,
  '.hub-access__secondary-actions > *': NOT_IN_HUB,
  '.hub-access__primary-actions > *': NOT_IN_HUB,
  '#posts-table tbody': CRM_SHELL,
  '#posts-table tbody::-webkit-scrollbar': CRM_SHELL,
  '#posts-table tbody tr': CRM_SHELL,
  '#posts-table tbody tr.post-detail-row': CRM_SHELL,
  'body:has(.mobile-nav-glass)': CRM_SHELL,
  "body:has(.app-container[data-phone-tab-bar='hidden'])": CRM_SHELL,
  '.app-container': CRM_SHELL,
  '.app-container[data-phone-page-header]': CRM_SHELL,
  "[data-theme='dark'] .app-container": CRM_SHELL,
};

interface Block {
  file: string;
  line: number;
  /** The block's own prelude, whitespace-normalized. */
  prelude: string;
  /** Every enclosing `@media` prelude, outermost first (all must match). */
  queries: string[];
  rules: postcss.Rule[];
  selectors: string[];
}

const WIDTH_FEATURE = /\b(min|max)-(width|height)\s*:/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function blocksOf(file: string): Block[] {
  const root = postcss.parse(readFileSync(path.join(ROOT, file), 'utf8'));
  const blocks = new Map<postcss.AtRule, Block>();
  root.walkRules((rule) => {
    const chain: postcss.AtRule[] = [];
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      if (p.type !== 'atrule') continue;
      const at = p as postcss.AtRule;
      if (/keyframes$/i.test(at.name)) return;
      if (at.name === 'media') chain.unshift(at);
    }
    const queries = chain.map((at) => norm(at.params));
    if (!queries.some((q) => WIDTH_FEATURE.test(q))) return;
    const node = chain[chain.length - 1];
    if (!blocks.has(node)) {
      blocks.set(node, {
        file,
        line: node.source?.start?.line ?? 0,
        prelude: queries[queries.length - 1],
        queries,
        rules: [],
        selectors: [],
      });
    }
    const block = blocks.get(node)!;
    block.rules.push(rule);
    block.selectors.push(...rule.selectors.map(norm));
  });
  return [...blocks.values()];
}

const blocks = CSS_GUARD_FILES.flatMap(blocksOf);
const matches = (block: Block, e: MediaEnv) =>
  block.queries.every((q) => matchesQuery(q, e, { unknownFeatures: 'true' }));
const where = (b: Block) => `${b.file}:${b.line}  @media ${b.prelude}`;
const keyOf = (b: Block) => `${b.prelude} | ${b.selectors[0]}`;
const declares = (rule: postcss.Rule, prop: string, value?: string) =>
  rule.nodes.some(
    (n) => n.type === 'decl' && n.prop === prop && (value === undefined || n.value === value),
  );

const { tokens } = publicTokens();
const isPublicClass = makeIsPublicClass(tokens);
const namesShellOnly = (sel: string) =>
  Object.keys(SHELL_ONLY).some((name) =>
    new RegExp(`${name.replace('.', '\\.')}(?![\\w-])`).test(sel),
  );
const isPublicSelector = (sel: string) =>
  requiredClasses(sel).every(isPublicClass) && !namesShellOnly(sel);
const shellSelectors = (b: Block) => b.selectors.filter((s) => !isPublicSelector(s));

const desktopReachesTablet = (b: Block) =>
  [T, Tp, TL].some((e) => matches(b, e)) && [D, N, M].some((e) => matches(b, e)) && !matches(b, P);
const phoneMissesTablet = (b: Block) => matches(b, P) && !(matches(b, T) && matches(b, Tp));

function hubTokens(): PublicTokens {
  const out: PublicTokens = { exact: new Set(), prefix: new Set(), suffix: new Set() };
  const hubSrc = path.join(ROOT, 'apps/hub/src');
  for (const rel of readdirSync(hubSrc, { recursive: true }) as string[]) {
    if (/\.(m?[jt]sx?)$/.test(rel)) collectTokens(parse(path.join(hubSrc, rel)), out);
  }
  const html = readFileSync(path.join(ROOT, 'apps/hub/index.html'), 'utf8');
  for (const word of html.split(/[^A-Za-z0-9_-]+/)) if (word) out.exact.add(word);
  return out;
}

describe('CRM stylesheets follow the phone-shell queries', () => {
  it('parses the guarded stylesheets', () => {
    expect(blocks.length).toBeGreaterThan(40);
  });

  it('no desktop range reaches a touch tablet', () => {
    const offenders = blocks
      .filter((b) => shellSelectors(b).length && desktopReachesTablet(b))
      .map((b) => `${where(b)}  ${shellSelectors(b)[0]}`);
    expect(offenders, 'use desktopShellQuery(...) from lib/phoneShell.ts').toEqual([]);
  });

  it('phone rules reach touch tablets', () => {
    const offenders = blocks
      .filter((b) => shellSelectors(b).length && phoneMissesTablet(b))
      .filter((b) => !REVIEWED_WIDTH_BLOCKS[keyOf(b)])
      .map((b) => `${where(b)}  key: '${keyOf(b)}'`);
    expect(offenders, 'use PHONE_SHELL_QUERY / the touch branch, or review').toEqual([]);
  });

  it('every reviewed width block still exists and still needs the review', () => {
    const live = new Set(
      blocks.filter((b) => shellSelectors(b).length && phoneMissesTablet(b)).map(keyOf),
    );
    expect(Object.keys(REVIEWED_WIDTH_BLOCKS).filter((k) => !live.has(k))).toEqual([]);
  });

  it('public blocks keep their widths', () => {
    const mixed = blocks
      .filter((b) => b.selectors.some(isPublicSelector) && shellSelectors(b).length)
      .map(
        (b) =>
          `${where(b)}  public: ${b.selectors.find(isPublicSelector)}  shell: ${shellSelectors(b)[0]}`,
      );
    expect(mixed, 'split these: the public copy keeps the old prelude').toEqual([]);
  });

  it('the Mais sheet is not hidden on a touch tablet', () => {
    const hiding = blocks.filter((b) =>
      b.rules.some(
        (r) =>
          r.selectors.some((s) => s.includes('.mobile-more-sheet')) &&
          declares(r, 'display', 'none'),
      ),
    );
    expect(hiding.length).toBeGreaterThan(0);
    for (const b of hiding) {
      expect(matches(b, T), where(b)).toBe(false);
      expect(matches(b, Tp), where(b)).toBe(false);
    }
  });

  it('banner and toasts clear the tab bar on tablets', () => {
    const banner = blocks.filter((b) =>
      b.selectors.includes('body:has(.mobile-nav-glass) .cookie-banner'),
    );
    const toast = blocks.filter((b) => b.rules.some((r) => declares(r, '--phone-toast-offset')));
    expect(banner.length).toBeGreaterThan(0);
    expect(toast.length).toBeGreaterThan(0);
    for (const b of [...banner, ...toast]) {
      for (const e of [P, T, Tp]) expect(matches(b, e), where(b)).toBe(true);
    }
  });

  it('Hub classes in newly matching phone blocks are reviewed', () => {
    const isHubClass = makeIsPublicClass(hubTokens());
    const found = new Set<string>();
    for (const b of blocks) {
      if (!(matches(b, P) && matches(b, T))) continue;
      for (const sel of b.selectors) {
        if (requiredClasses(sel).every(isHubClass)) found.add(sel);
      }
    }
    const unreviewed = [...found].filter((s) => !HUB_REVIEWED_SELECTORS[s]);
    expect(unreviewed, 'these can match Hub markup on a touch tablet: review them').toEqual([]);
    expect(Object.keys(HUB_REVIEWED_SELECTORS).filter((s) => !found.has(s))).toEqual([]);
  });

  it('no bare phone/desktop width in JS', () => {
    const offenders: string[] = [];
    for (const rel of readdirSync(SRC, { recursive: true }) as string[]) {
      if (!/\.(m?[jt]sx?)$/.test(rel) || /__tests__|\.test\.|^test\//.test(rel)) continue;
      if (rel === path.join('lib', 'phoneShell.ts')) continue;
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          /(^|\.)matchMedia$/.test(node.expression.getText()) &&
          /767|768px/.test(node.arguments[0]?.getText() ?? '')
        ) {
          offenders.push(`${rel}: ${node.getText()}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(path.join(SRC, rel)));
    }
    expect(offenders, 'use the queries in lib/phoneShell.ts').toEqual([]);
  });
});
