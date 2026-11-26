import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards the signed-in CRM against new hard-coded Portuguese.
 *
 * Scans every .tsx under pages/ and components/ (not __tests__) and flags JSX text and string
 * literals with an accented Portuguese letter. Comments never count (the AST skips them), and so
 * do `t(...)` / `i18n.t(...)` arguments (keys and defaultValue), import/export specifiers and
 * console.* arguments.
 *
 * The baseline lists the files that still have hits. A file outside it with hits fails, and a
 * baseline file with no hits left fails too, so the list can only shrink.
 */

const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '../../..');
const BASELINE_FILE = path.join(__dirname, 'noHardcodedPortuguese.baseline.json');
const ACCENT = /[ãâáàçéêíóôõú]/i;

// Portuguese-only public pages (see PUBLIC_ROUTES in content/site-meta.ts, locale absent = 'pt'),
// plus the Brazil-only affiliate program. Marketing pages live under pages/marketing. pages/en is
// English-only. Hard-coded here because route paths do not map 1:1 to page directories.
const ALLOWED_DIRS = [
  'pages/landing',
  'pages/precos',
  'pages/sobre',
  'pages/blog',
  'pages/novidades',
  'pages/lgpd',
  'pages/termos-de-uso',
  'pages/politica-privacidade',
  'pages/afiliados',
  'pages/marketing',
  'pages/en',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isTranslationCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 't';
  if (ts.isPropertyAccessExpression(callee)) {
    if (callee.name.text === 't') return true;
    // console.log("...") and friends
    return ts.isIdentifier(callee.expression) && callee.expression.text === 'console';
  }
  return false;
}

function firstHit(file: string): string | null {
  const text = readFileSync(file, 'utf8');
  if (!ACCENT.test(text)) return null;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let hit: string | null = null;
  const visit = (node: ts.Node) => {
    if (hit) return;
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      isTranslationCall(node)
    ) {
      return;
    }
    if (
      ts.isJsxText(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      const value = node.text.trim();
      if (ACCENT.test(value)) {
        hit = value.replace(/\s+/g, ' ').slice(0, 80);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hit;
}

describe('no new hard-coded Portuguese in the signed-in CRM', () => {
  const files = [...walk(path.join(SRC, 'pages')), ...walk(path.join(SRC, 'components'))]
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .filter((rel) => {
      const inSrc = rel.replace('apps/crm/src/', '');
      return !ALLOWED_DIRS.some((d) => inSrc.startsWith(d + '/'));
    })
    .sort();

  const hits = new Map<string, string>();
  for (const rel of files) {
    const h = firstHit(path.join(ROOT, rel));
    if (h) hits.set(rel, h);
  }
  const baseline: string[] = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));

  it('has no hard-coded Portuguese outside the baseline', () => {
    const offenders = [...hits].filter(([f]) => !baseline.includes(f));
    expect(
      offenders,
      `Hard-coded Portuguese found. Move each string into packages/i18n/locales/{pt,en} and use t():\n` +
        offenders.map(([f, s]) => `  ${f}: "${s}"`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the baseline free of clean files', () => {
    const stale = baseline.filter((f) => !hits.has(f));
    expect(
      stale,
      `These files no longer have hard-coded Portuguese (or no longer exist). Remove them from ` +
        `apps/crm/src/__tests__/noHardcodedPortuguese.baseline.json:\n` +
        stale.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the baseline sorted', () => {
    expect(baseline).toEqual([...baseline].sort());
  });
});
