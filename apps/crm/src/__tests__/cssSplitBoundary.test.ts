import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

const ROOT = process.cwd();
const CRM = path.join(ROOT, 'apps/crm');
const SRC = path.join(CRM, 'src');

// '@/...' plus the '@mesaas/*' aliases, read from the CRM's Vite config so they never drift.
const ALIASES: [string, string][] = [['@', SRC]];
{
  const viteConfig = readFileSync(path.join(CRM, 'vite.config.ts'), 'utf8');
  for (const m of viteConfig.matchAll(
    /'(@mesaas\/[\w-]+)':\s*path\.resolve\(\s*__dirname,\s*'([^']+)',?\s*\)/g,
  )) {
    ALIASES.push([m[1], path.resolve(CRM, m[2])]);
  }
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
function resolveImport(spec: string, from: string): string | null {
  const clean = spec.split('?')[0];
  let base: string | null = null;
  if (clean.startsWith('.')) base = path.resolve(path.dirname(from), clean);
  for (const [alias, target] of ALIASES) {
    if (clean === alias || clean.startsWith(alias + '/')) base = target + clean.slice(alias.length);
  }
  if (!base) return null; // npm package: not walked
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

const isScript = (file: string) => /\.(m?[jt]sx?)$/.test(file);
const parse = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const isDynamicImport = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  node.expression.kind === ts.SyntaxKind.ImportKeyword &&
  !!node.arguments[0] &&
  ts.isStringLiteralLike(node.arguments[0]);

/** Static and dynamic import specifiers under `root`. */
function importsOf(root: ts.Node): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (isDynamicImport(node)) {
      out.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

/** Files App.tsx lazy-loads for routes rendered inside <ProtectedRoute> (nested child routes
 * included), plus ProtectedRoute and AppLayout themselves. */
function protectedRouteFiles(): Set<string> {
  const appFile = path.join(SRC, 'App.tsx');
  const sf = parse(appFile);
  // Top-level declaration -> the imports inside it and the identifiers it references, so a
  // wrapper (LandingPage -> LandingPageLazy, MarketingRoute) resolves to the modules it loads.
  const declImports = new Map<string, string[]>();
  const declRefs = new Map<string, Set<string>>();
  for (const st of sf.statements) {
    const names: string[] = [];
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name) names.push(st.name.text);
    if (!names.length) continue;
    const refs = new Set<string>();
    const collect = (n: ts.Node) => {
      if (ts.isIdentifier(n)) refs.add(n.text);
      ts.forEachChild(n, collect);
    };
    collect(st);
    const specs = importsOf(st);
    for (const name of names) {
      declImports.set(name, specs);
      declRefs.set(name, refs);
    }
  }

  const protectedTags = new Set(['ProtectedRoute', 'AppLayout']);
  const tagsIn = (node: ts.Node) => {
    const tags = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        tags.add(n.tagName.getText(sf));
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return tags;
  };
  const visitRoutes = (node: ts.Node, insideProtected: boolean) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      if (open.tagName.getText(sf) === 'Route') {
        let isProtected = insideProtected;
        let tags = new Set<string>();
        for (const attr of open.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(sf) === 'element' && attr.initializer) {
            tags = tagsIn(attr.initializer);
            if (tags.has('ProtectedRoute')) isProtected = true;
          }
        }
        if (isProtected) tags.forEach((t) => protectedTags.add(t));
        if (ts.isJsxElement(node)) node.children.forEach((c) => visitRoutes(c, isProtected));
        return;
      }
    }
    ts.forEachChild(node, (c) => visitRoutes(c, insideProtected));
  };
  visitRoutes(sf, false);

  const files = new Set<string>();
  const seen = new Set<string>();
  const follow = (name: string) => {
    if (seen.has(name) || !declImports.has(name)) return;
    seen.add(name);
    for (const spec of declImports.get(name)!) {
      const file = resolveImport(spec, appFile);
      if (file) files.add(file);
    }
    for (const ref of declRefs.get(name)!) follow(ref);
  };
  protectedTags.forEach(follow);
  return files;
}

interface PublicTokens {
  exact: Set<string>;
  prefix: Set<string>;
  suffix: Set<string>;
}

function addPartial(set: Set<string>, token: string) {
  if (token.replace(/[^A-Za-z0-9]/g, '').length >= 2) set.add(token);
}

/** Adds the words of one literal piece. `openLeft`/`openRight`: an interpolation touches that
 * edge, so the word there is only part of a class name. */
function addPiece(tokens: PublicTokens, text: string, openLeft: boolean, openRight: boolean) {
  for (const word of text.split(/[^A-Za-z0-9_-]+/)) if (word) tokens.exact.add(word);
  const head = /^[A-Za-z0-9_-]+/.exec(text)?.[0];
  const tail = /[A-Za-z0-9_-]+$/.exec(text)?.[0];
  // `status-${x}` and 'status-' + x make every status-* class public; `${x}-active` every *-active.
  if (tail && (openRight || tail.endsWith('-'))) addPartial(tokens.prefix, tail);
  if (head && (openLeft || head.startsWith('-'))) addPartial(tokens.suffix, head);
}

function collectTokens(sf: ts.SourceFile, tokens: PublicTokens) {
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addPiece(tokens, node.text, false, false);
    } else if (ts.isTemplateExpression(node)) {
      addPiece(tokens, node.head.text, false, true);
      node.templateSpans.forEach((span, i) =>
        addPiece(tokens, span.literal.text, true, i < node.templateSpans.length - 1),
      );
    } else if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name)
    ) {
      tokens.exact.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function publicTokens(): { tokens: PublicTokens; files: Set<string> } {
  const blocked = protectedRouteFiles();
  const roots = [path.join(SRC, 'main.tsx'), path.join(ROOT, 'scripts/seo/prerender.tsx')];
  for (const f of readdirSync(path.join(SRC, 'content'))) {
    if (f.endsWith('.seo.ts')) roots.push(path.join(SRC, 'content', f));
  }
  const tokens: PublicTokens = { exact: new Set(), prefix: new Set(), suffix: new Set() };
  const files = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file) || blocked.has(file) || !isScript(file)) continue;
    files.add(file);
    const sf = parse(file);
    collectTokens(sf, tokens);
    for (const spec of importsOf(sf)) {
      const target = resolveImport(spec, file);
      if (target) queue.push(target);
    }
  }
  const plain = [path.join(CRM, 'index.html')];
  const blogDir = path.join(SRC, 'content/blog');
  for (const f of readdirSync(blogDir)) if (f.endsWith('.md')) plain.push(path.join(blogDir, f));
  for (const f of plain) {
    files.add(f);
    for (const word of readFileSync(f, 'utf8').split(/[^A-Za-z0-9_-]+/)) {
      if (word) tokens.exact.add(word);
    }
  }
  return { tokens, files };
}

/** Class names outside any (...) or [...] of one selector: those the element (or an ancestor)
 * must carry for the selector to match. */
function requiredClasses(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < selector.length && selector[i] !== ch) i += selector[i] === '\\' ? 2 : 1;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === '.') {
      let name = '';
      let j = i + 1;
      while (j < selector.length) {
        if (selector[j] === '\\') {
          name += selector[j + 1] ?? '';
          j += 2;
        } else if (/[\w-]/.test(selector[j]) || selector.charCodeAt(j) > 0x7f) {
          name += selector[j++];
        } else break;
      }
      if (name && depth === 0 && !/^\d/.test(name)) out.push(name);
      i = j - 1;
    }
  }
  return out;
}

const { tokens, files } = publicTokens();
const isPublicClass = (cls: string) =>
  tokens.exact.has(cls) ||
  [...tokens.prefix].some((p) => cls.startsWith(p)) ||
  [...tokens.suffix].some((s) => cls.endsWith(s));

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
