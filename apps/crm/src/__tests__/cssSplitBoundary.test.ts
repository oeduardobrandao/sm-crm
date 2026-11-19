import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CRM,
  makeIsPublicClass,
  parse,
  publicTokens,
  requiredClasses,
  ROOT,
  SRC,
} from '../test/publicCssClasses';

/**
 * Guards the style.css / app.css split.
 *
 * apps/crm/style.css is the render-blocking core every page loads. apps/crm/app.css only loads
 * with the ProtectedRoute chunk (src/styles/app-shell.ts), so a public page (landing, preços, blog,
 * marketing, legal, login, afiliados, the cookie banner...) never gets it. A rule may live in
 * app.css only if EVERY one of its selectors names at least one class that no public code uses:
 * then it cannot match anything a public page renders.
 *
 * "Public code" = the modules reached by a static import walk from main.tsx, the public lazy
 * routes in App.tsx (every route not rendered inside <ProtectedRoute>) and the prerender script,
 * following dynamic imports too but never entering ProtectedRoute, AppLayout or an authenticated
 * page; plus index.html and the markdown the blog loads. Class names are collected from those
 * files' string and template literals (a `status-${x}` template makes every `status-*` class
 * public) and from object-literal keys (`cn({ active: x })`).
 *
 * Classes inside :not()/:has()/:is()/:where() arguments never make a selector app-only: the
 * selector can still match an element without them.
 *
 * When this fails: move the listed rule back to style.css (keep its relative order), or stop
 * using the class on the public page.
 */

const { tokens, files } = publicTokens();
const isPublicClass = makeIsPublicClass(tokens);

const appCss = postcss.parse(readFileSync(path.join(CRM, 'app.css'), 'utf8'));
const coreCss = postcss.parse(readFileSync(path.join(CRM, 'style.css'), 'utf8'));
const insideKeyframes = (node: postcss.Node) =>
  node.parent?.type === 'atrule' && /keyframes$/i.test((node.parent as postcss.AtRule).name);

// ---- Tailwind variant ties. Tailwind emits variant utilities (hover:, focus-visible:,
// data-[state=on]:, md:, dark: ...) at the end of style.css, the file holding `@tailwind
// utilities`, so they load BEFORE app.css. An app.css rule that ties one on specificity, on an
// element carrying both classes, and sets an overlapping property, would win where it lost when
// it sat in style.css. Same-element = written in the same className, or the className of a
// components/ui primitive whose own source (cva) carries the variant.
const hasVariant = (token: string) => /:/.test(token.replace(/\[[^\]]*\]/g, ''));
const variantTokens = (text: string) =>
  text.split(/[\s'"`,{}()]+/).filter((t) => /^[!\w[@-]/.test(t) && hasVariant(t));

/** "ids,classes,elements" of a selector (escapes, :where, nth args and :is/:not/:has handled). */
function specificity(selector: string): string {
  const s = selector
    .replace(/\\./g, 'x')
    .replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/:(nth-[\w-]+|lang|dir)\([^)]*\)/g, ':pc')
    .replace(/:(is|not|has|matches)\(|\)/g, ' ');
  const attrs = (s.match(/\[[^\]]*\]/g) ?? []).length;
  const rest = s.replace(/\[[^\]]*\]/g, '');
  const pseudoEls = (rest.match(/::[\w-]+|:(before|after|first-line|first-letter)\b/g) ?? [])
    .length;
  const simple = rest.replace(/::[\w-]+|:(before|after|first-line|first-letter)\b/g, '');
  const ids = (simple.match(/#[\w-]+/g) ?? []).length;
  const classes = (simple.match(/[.:][\w-]+/g) ?? []).length;
  const tags = (simple.replace(/[.:#][\w-]+/g, ' ').match(/(^|[\s>+~,])[a-z][\w-]*/gi) ?? [])
    .length;
  return `${ids},${classes + attrs},${tags + pseudoEls}`;
}

// Shorthand/longhand-aware: `border` vs `border-top-color` overlap, `border` vs `border-radius`
// and `margin-bottom` vs `margin-left` do not.
const norm = (p: string) =>
  p.replace(/^-(webkit|moz|ms)-/, '').replace(/^(top|right|bottom|left)$/, 'inset-$1');
const BOX =
  /^(margin|padding|border|inset|scroll-margin|scroll-padding)(?:-(top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-(width|style|color))?$/;
function propsOverlap(rawA: string, rawB: string): boolean {
  const [a, b] = [norm(rawA), norm(rawB)];
  if (a === b) return true;
  if (a.startsWith('--') || b.startsWith('--')) return false;
  const radius = (p: string) => /^border(-\w+-\w+)?-radius$/.test(p);
  if (radius(a) || radius(b)) {
    return radius(a) && radius(b) && (a === 'border-radius' || b === 'border-radius');
  }
  const [x, y] = [BOX.exec(a), BOX.exec(b)];
  if (x && y) {
    const logical = (side?: string) => !side || /block|inline/.test(side);
    const sides = logical(x[2]) || logical(y[2]) || x[2] === y[2];
    return x[1] === y[1] && sides && (!x[3] || !y[3] || x[3] === y[3]);
  }
  return a.startsWith(b + '-') || b.startsWith(a + '-');
}

function variantCooccurrence(): Map<string, Set<string>> {
  const uiDir = path.join(SRC, 'components/ui');
  const own = new Map<string, string[]>();
  const primitive = new Map<string, Set<string>>();
  for (const f of readdirSync(uiDir).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(path.join(uiDir, f), 'utf8');
    const deps = [...src.matchAll(/from '(?:@\/components\/ui\/|\.\/)([\w-]+)'/g)].map((m) => m[1]);
    own.set(f, [...variantTokens(src), ...deps.map((d) => `@dep:${d}.tsx`)]);
  }
  const expand = (f: string, seen = new Set<string>()): string[] =>
    seen.has(f)
      ? []
      : (seen.add(f),
        (own.get(f) ?? []).flatMap((t) =>
          t.startsWith('@dep:') ? expand(t.slice(5), seen) : [t],
        ));
  for (const f of own.keys()) {
    const src = readFileSync(path.join(uiDir, f), 'utf8');
    for (const m of src.matchAll(/(?:const|function)\s+([A-Z]\w+)/g))
      primitive.set(m[1], new Set(expand(f)));
  }
  const out = new Map<string, Set<string>>();
  for (const dir of [SRC, path.join(ROOT, 'apps/hub/src'), path.join(ROOT, 'packages')]) {
    for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
      if (!rel.endsWith('.tsx') || /node_modules|__tests__/.test(rel)) continue;
      const file = path.join(dir, rel);
      // Every className attribute: its literal pieces, plus the variants of a ui primitive tag.
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText() === 'className' && node.initializer) {
          const pieces: string[] = [];
          const collect = (n: ts.Node) => {
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) pieces.push(n.text);
            if (ts.isTemplateExpression(n)) {
              pieces.push(n.head.text, ...n.templateSpans.map((t) => t.literal.text));
            }
            ts.forEachChild(n, collect);
          };
          collect(node.initializer);
          const text = pieces.join(' ');
          const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText();
          const variants = [...variantTokens(text), ...(primitive.get(tag) ?? [])];
          for (const cls of variants.length ? text.split(/[^\w-]+/) : []) {
            if (!out.has(cls)) out.set(cls, new Set());
            for (const v of variants) out.get(cls)!.add(v);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(file));
    }
  }
  return out;
}

describe('style.css / app.css split', () => {
  it('walks a sane public module set', () => {
    const rel = [...files].map((f) => path.relative(ROOT, f));
    expect(rel).toContain('apps/crm/src/pages/landing/LandingPage.tsx');
    expect(rel).toContain('apps/crm/src/pages/login/LoginPage.tsx');
    expect(rel).toContain('apps/crm/src/components/consent/CookieConsent.tsx');
    expect(rel).not.toContain('apps/crm/src/components/layout/ProtectedRoute.tsx');
    expect(rel).not.toContain('apps/crm/src/components/layout/AppLayout.tsx');
    expect(rel).not.toContain('apps/crm/src/pages/dashboard/DashboardPage.tsx');
  });

  it('keeps every app.css selector out of reach of public pages', () => {
    const offenders: string[] = [];
    appCss.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      for (const selector of rule.selectors) {
        const required = requiredClasses(selector);
        if (!required.some((cls) => !isPublicClass(cls))) {
          const why = required.length
            ? `every class is used by public code (${required.join(', ')})`
            : 'no required class';
          offenders.push(`app.css:${rule.source?.start?.line}  ${selector}  -> ${why}`);
        }
      }
    });
    expect(offenders, 'move these rules back to style.css').toEqual([]);
  });

  it('keeps Tailwind-only constructs in style.css', () => {
    const found: string[] = [];
    appCss.walkAtRules((at) => {
      if (['apply', 'tailwind', 'layer'].includes(at.name)) found.push(`@${at.name}`);
    });
    expect(found).toEqual([]);
  });

  it('only moves keyframes that no core rule or public code animates with', () => {
    const coreAnimations = new Set<string>();
    coreCss.walkDecls(/^(-webkit-)?animation(-name)?$/, (decl) => {
      for (const word of decl.value.split(/[\s,]+/)) coreAnimations.add(word);
    });
    const coreKeyframes = new Set<string>();
    coreCss.walkAtRules(/keyframes$/i, (at) => coreKeyframes.add(at.params.trim()));
    const bad: string[] = [];
    appCss.walkAtRules(/keyframes$/i, (at) => {
      const name = at.params.trim();
      if (coreAnimations.has(name)) bad.push(`${name}: animated by a style.css rule`);
      if (tokens.exact.has(name)) bad.push(`${name}: named in public code`);
      if (coreKeyframes.has(name)) bad.push(`${name}: also defined in style.css`);
    });
    expect(bad).toEqual([]);
  });

  it('keeps rules that tie a Tailwind variant utility on the same element in style.css', async () => {
    const cooc = variantCooccurrence();
    const candidates = new Set([...cooc.values()].flatMap((s) => [...s]));
    // Tailwind itself says what each candidate generates (selector + properties).
    const config = loadConfig(path.join(ROOT, 'tailwind.config.js'));
    const out = await postcss([
      tailwindcss({ ...config, content: [{ raw: [...candidates].join(' '), extension: 'html' }] }),
    ]).process('@tailwind utilities;', { from: undefined });
    const generated = new Map<string, { spec: string; props: string[] }[]>();
    out.root.walkRules((rule) => {
      const props = (rule.nodes ?? []).flatMap((n) => (n.type === 'decl' ? [n.prop] : []));
      for (const selector of rule.selectors) {
        const names = [...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
          m[1].replace(/\\(.)/g, '$1'),
        );
        const name = names.find(hasVariant);
        if (!name) continue;
        if (!generated.has(name)) generated.set(name, []);
        generated.get(name)!.push({ spec: specificity(selector), props });
      }
    });
    expect(generated.size).toBeGreaterThan(50);
    const ties: string[] = [];
    appCss.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      const props = (rule.nodes ?? []).flatMap((n) => (n.type === 'decl' ? [n.prop] : []));
      for (const selector of rule.selectors) {
        const spec = specificity(selector);
        for (const cls of requiredClasses(selector)) {
          for (const variant of cooc.get(cls) ?? []) {
            const tie = (generated.get(variant) ?? []).find(
              (g) => g.spec === spec && g.props.some((p) => props.some((q) => propsOverlap(p, q))),
            );
            if (tie) ties.push(`app.css:${rule.source?.start?.line}  ${selector}  ties ${variant}`);
          }
        }
      }
    });
    expect(ties, 'move these rules back to style.css, or out-specify the variant').toEqual([]);
  });
});
