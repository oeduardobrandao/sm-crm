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

const cssUnder = (dir: string) =>
  (readdirSync(path.join(ROOT, dir), { recursive: true }) as string[])
    .filter((rel) => rel.endsWith('.css'))
    .map((rel) => path.join(dir, rel))
    .sort();
/** The two core sheets, then the files later tasks added to the guard (Vidro, page and component CSS). */
const CORE_FILES = ['apps/crm/style.css', 'apps/crm/app.css'];
/**
 * Sheets that are never part of the signed-in shell, so the phone-shell queries do not apply.
 * Their selectors would read as "shell" because the classes are orphans or the page is standalone.
 */
const NOT_SHELL_FILES: Record<string, string> = {
  'apps/crm/src/pages/landing/landing.css': 'public landing (some classes are orphans in JS)',
  'apps/crm/src/pages/landing/landing-v2.css': 'public landing',
  'apps/crm/src/pages/blog/blog.css': 'public blog',
  'apps/crm/src/pages/workspace-setup/workspace-setup.css':
    'standalone onboarding card on the auth backdrop: no AppLayout, no phone shell',
  'apps/crm/src/pages/comecar/comecar.css':
    '/comecar sits behind ProtectedRoute but outside AppLayout: a standalone page, no phone shell',
};
const CSS_GUARD_FILES = [
  ...CORE_FILES,
  ...['styles', 'pages', 'components'].flatMap((d) => cssUnder(`apps/crm/src/${d}`)),
].filter((f) => !NOT_SHELL_FILES[f]);
/** Files this task added to the guard: Hub classes in desktop blocks are only checked in these. */
const ADDED_FILES = new Set(CSS_GUARD_FILES.filter((f) => !CORE_FILES.includes(f)));

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
 * NOT_IN_HUB: the Hub/packages word is an id, key, i18n string or template partial
 * (`post-${id}`, `${id}-panel`, `hub-${id}`, 'sidebar.*'), checked by grep.
 */
const NOT_IN_HUB = 'the Hub never renders this class; only an id, key or template partial matches';
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
  '.kpi-label': NOT_IN_HUB,
  '.calendar-detail-foot': NOT_IN_HUB,
  '.config-nav-label': NOT_IN_HUB,
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

/**
 * Blocks whose selectors are all public but whose prelude has the touch branch, on purpose: a
 * public page is also seen on a touch tablet, and these ride the signed-in tab bar. Converting a
 * public block wholesale changes a public page on iPad, so each one is listed. Key:
 * `<prelude> | <first selector>`.
 */
const PUBLIC_TOUCH_BLOCKS: Record<string, string> = {
  '(hover: none) and (pointer: coarse) and (min-width: 768px) | .phone-kit.phone-sheet':
    'sheet cap on wide phone shells: ui/dialog makes the classes public, but the phone faces render only inside AppLayout (usePhoneLayout().isPhone), never on a public page',
};

/**
 * Selectors that can match Hub markup (every required class, `:has()` ones included, appears in
 * Hub code) inside a desktop block a touch tablet no longer matches, in the sheets Task 4 added.
 * The Hub imports them. Key: the selector. Value: why the Hub on a tablet does not need the rule.
 */
const HUB_DESKTOP_REVIEWED_SELECTORS: Record<string, string> = {};

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

/** Classes named inside `:has(...)` arguments: the selector only matches under an element that has them. */
function hasClasses(selector: string): string[] {
  const out: string[] = [];
  for (let at = selector.indexOf(':has('); at !== -1; at = selector.indexOf(':has(', at + 1)) {
    let depth = 0;
    let i = at + ':has'.length;
    const start = i + 1;
    for (; i < selector.length; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')' && --depth === 0) break;
    }
    out.push(...requiredClasses(selector.slice(start, i)));
  }
  return out;
}
/** Ids outside brackets and parentheses. */
function requiredIds(selector: string): string[] {
  const stripped = selector.replace(/\([^()]*(\([^()]*\)[^()]*)*\)|\[[^\]]*\]/g, '');
  return [...stripped.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
}
const isPublicId = (id: string) => tokens.exact.has(id);
const isPublicSelector = (sel: string) => {
  const classes = requiredClasses(sel);
  const ids = requiredIds(sel);
  return (
    classes.every(isPublicClass) &&
    hasClasses(sel).every(isPublicClass) &&
    // an id-only selector is shell unless public code uses the id
    (classes.length > 0 || ids.every(isPublicId)) &&
    !namesShellOnly(sel)
  );
};
const TOUCH_BRANCH = /\(hover:\s*none\)|\(pointer:\s*coarse\)/;
const publicTouchBlocks = (list: Block[]) =>
  list.filter(
    (b) =>
      b.selectors.length &&
      b.selectors.every(isPublicSelector) &&
      b.queries.some((q) => TOUCH_BRANCH.test(q)),
  );
const shellSelectors = (b: Block) => b.selectors.filter((s) => !isPublicSelector(s));

const desktopReachesTablet = (b: Block) =>
  [T, Tp, TL].some((e) => matches(b, e)) && [D, N, M].some((e) => matches(b, e)) && !matches(b, P);
const phoneMissesTablet = (b: Block) => matches(b, P) && !(matches(b, T) && matches(b, Tp));

function hubTokens(): PublicTokens {
  const out: PublicTokens = { exact: new Set(), prefix: new Set(), suffix: new Set() };
  // The Hub's own code plus packages/ (its @mesaas/* aliases: ui, report-blocks...).
  for (const dir of ['apps/hub/src', 'packages'].map((d) => path.join(ROOT, d))) {
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      if (/\.(m?[jt]sx?)$/.test(rel) && !/node_modules/.test(rel)) {
        collectTokens(parse(path.join(dir, rel)), out);
      }
    }
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

  it('skipped sheets carry no touch branch', () => {
    const offenders = Object.keys(NOT_SHELL_FILES).filter((f) =>
      TOUCH_BRANCH.test(readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(offenders, 'a skipped sheet must not target touch tablets').toEqual([]);
  });

  it('public blocks that gained the touch branch are listed', () => {
    const publicTouch = publicTouchBlocks(blocks);
    const keys = publicTouch.map(keyOf);
    expect(
      publicTouch.filter((b) => !PUBLIC_TOUCH_BLOCKS[keyOf(b)]).map(where),
      'a public page changes on touch tablets: keep the old prelude or list the block',
    ).toEqual([]);
    expect(Object.keys(PUBLIC_TOUCH_BLOCKS).filter((k) => !keys.includes(k))).toEqual([]);
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

  it('banner, Crisp bubble and toasts clear the tab bar on tablets', () => {
    const holding = (selector: string) => blocks.filter((b) => b.selectors.includes(selector));
    const banner = holding('body:has(.mobile-nav-glass) .cookie-banner');
    const crisp = holding('body:has(.mobile-nav-glass) .crisp-client');
    const toast = blocks.filter((b) => b.rules.some((r) => declares(r, '--phone-toast-offset')));
    expect(banner.length).toBeGreaterThan(0);
    expect(crisp.length).toBeGreaterThan(0);
    expect(toast.length).toBeGreaterThan(0);
    for (const b of [...banner, ...crisp, ...toast]) {
      for (const e of [P, T, Tp]) expect(matches(b, e), where(b)).toBe(true);
    }
  });

  it('wide phone shells get the column, the tab bar cap and the sheet caps', () => {
    const landscapePhone = env(844, 390, true);
    const capping = (selector: string, prop: string, value: string) =>
      blocks.filter((b) =>
        b.rules.some(
          (r) =>
            r.selectors.map(norm).includes(selector) &&
            r.nodes.some((n) => n.type === 'decl' && n.prop === prop && norm(n.value) === value),
        ),
      );
    const caps = [
      capping(
        '.app-container:not([data-phone-wide]) .main-content',
        'padding-inline',
        // postcss keeps `!important` out of the value (decl.important)
        'max(1rem, calc((100% - 680px) / 2))',
      ),
      capping('.mobile-nav-glass', 'max-width', '420px'),
      capping('.phone-kit.phone-sheet', 'max-width', '680px'),
      capping('.phone-kit.phone-alert', 'max-width', '680px'),
      capping('.phone-kit.phone-action-sheet', 'max-width', '680px'),
      ...[
        '.phone-editor-screen',
        '.phone-text-screen--open',
        '.drawer-panel.phone-ent-fluxo',
        '.phone-tar-screen',
        '.phone-notifications',
      ].map((screen) => capping(screen, 'padding-inline', 'max(0px, calc((100% - 680px) / 2))')),
      ...(['left', 'right'] as const).map((side) =>
        capping(
          'body .phone-bottom-bar',
          `padding-${side}`,
          `max( var(--phone-gutter), env(safe-area-inset-${side}, 0px), calc((100% - 680px) / 2) )`,
        ),
      ),
    ];
    for (const [i, found] of caps.entries()) {
      expect(found.length, `cap #${i}`).toBe(1);
      const [b] = found;
      for (const e of [T, Tp, landscapePhone]) expect(matches(b, e), where(b)).toBe(true);
      for (const e of [P, D, N]) expect(matches(b, e), where(b)).toBe(false);
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

  it('Hub classes in desktop blocks a touch tablet no longer matches are reviewed', () => {
    const hub = hubTokens();
    const isHubClass = makeIsPublicClass(hub);
    // Every Vidro selector needs html[data-look='vidro'], which only the CRM sets (lib/vidroLook.ts):
    // the Hub never renders it, so none of those selectors can match Hub markup.
    expect(hub.exact.has('data-look'), 'the Hub now names data-look: review Vidro').toBe(false);
    const found = new Set<string>();
    for (const b of blocks) {
      if (!ADDED_FILES.has(b.file)) continue;
      if (!(matches(b, D) && !matches(b, T))) continue;
      for (const sel of b.selectors) {
        if (sel.includes("[data-look='vidro']")) continue;
        if ([...requiredClasses(sel), ...hasClasses(sel)].every(isHubClass)) found.add(sel);
      }
    }
    const unreviewed = [...found].filter((s) => !HUB_DESKTOP_REVIEWED_SELECTORS[s]);
    expect(unreviewed, 'the Hub imports these sheets: review them').toEqual([]);
    expect(Object.keys(HUB_DESKTOP_REVIEWED_SELECTORS).filter((s) => !found.has(s))).toEqual([]);
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

describe('the guard classifier', () => {
  it('reads selectors as public or shell', () => {
    expect(isPublicSelector('.card')).toBe(true);
    expect(isPublicSelector('body')).toBe(true);
    expect(isPublicSelector('body:has(.mobile-nav-glass) .x')).toBe(false);
    expect(isPublicSelector('body:has(.mobile-nav-glass) .crisp-client')).toBe(false);
    expect(isPublicSelector('#posts-table')).toBe(false);
    expect(isPublicSelector('#posts-table tbody tr')).toBe(false);
    expect(isPublicSelector('.sidebar')).toBe(false);
  });

  it('fails an all-public block that has the touch branch', () => {
    const block = (prelude: string, selectors: string[]): Block => ({
      file: 'x.css',
      line: 1,
      prelude,
      queries: [prelude],
      rules: [],
      selectors,
    });
    const touch = block('(max-width: 767px), (hover: none) and (pointer: coarse)', ['.card']);
    const plain = block('(max-width: 767px)', ['.card']);
    const shellTouch = block('(max-width: 767px), (hover: none) and (pointer: coarse)', [
      'body:has(.mobile-nav-glass) .x',
    ]);
    expect(publicTouchBlocks([touch, plain, shellTouch])).toEqual([touch]);
  });
});
