import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Test helper: the class names public CRM code uses (landing, preços, blog, login, the cookie
 * banner...), shared by cssSplitBoundary.test.ts and phoneShellCss.test.ts. See the header of
 * cssSplitBoundary.test.ts for how "public code" is walked.
 */

export const ROOT = process.cwd();
export const CRM = path.join(ROOT, 'apps/crm');
export const SRC = path.join(CRM, 'src');

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
export const parse = (file: string) =>
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

export interface PublicTokens {
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

export function collectTokens(sf: ts.SourceFile, tokens: PublicTokens) {
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

export function publicTokens(): { tokens: PublicTokens; files: Set<string> } {
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
export function requiredClasses(selector: string): string[] {
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

/** `publicTokens()` as a predicate on one class name. */
export function makeIsPublicClass(tokens: PublicTokens): (cls: string) => boolean {
  return (cls) =>
    tokens.exact.has(cls) ||
    [...tokens.prefix].some((p) => cls.startsWith(p)) ||
    [...tokens.suffix].some((s) => cls.endsWith(s));
}
