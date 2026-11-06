import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const LOCALES = path.join(ROOT, 'packages/i18n/locales');
const LANGS = ['pt', 'en'] as const;
const APPS = ['apps/crm/src', 'apps/hub/src'];

type Json = { [k: string]: string | Json };

function flatten(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function loadKeys(lang: string): Map<string, Set<string>> {
  const byNs = new Map<string, Set<string>>();
  for (const file of fs.readdirSync(path.join(LOCALES, lang))) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(fs.readFileSync(path.join(LOCALES, lang, file), 'utf8')) as Json;
    byNs.set(file.replace(/\.json$/, ''), new Set(flatten(json)));
  }
  return byNs;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec|d)\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const keysByLang = Object.fromEntries(LANGS.map((l) => [l, loadKeys(l)])) as Record<
  (typeof LANGS)[number],
  Map<string, Set<string>>
>;

describe('locale parity', () => {
  it('pt and en ship the same namespace files', () => {
    expect([...keysByLang.en.keys()].sort()).toEqual([...keysByLang.pt.keys()].sort());
  });

  for (const ns of keysByLang.pt.keys()) {
    it(`${ns}: pt and en have the same keys`, () => {
      const pt = keysByLang.pt.get(ns)!;
      const en = keysByLang.en.get(ns) ?? new Set<string>();
      expect({
        missingInEn: [...pt].filter((k) => !en.has(k)),
        missingInPt: [...en].filter((k) => !pt.has(k)),
      }).toEqual({ missingInEn: [], missingInPt: [] });
    });
  }
});

// A key passed with a default (`t('x', 'Cliente')`) that exists in neither locale renders the
// Portuguese default in every language, so every literal key must resolve.
describe('literal t() keys resolve', () => {
  const pt = keysByLang.pt;
  const resolves = (ns: string, key: string) => {
    const set = pt.get(ns);
    if (!set) return false;
    if (set.has(key) || set.has(`${key}_one`) || set.has(`${key}_other`)) return true;
    // returnObjects lookups target a subtree.
    for (const k of set) if (k.startsWith(`${key}.`)) return true;
    return false;
  };

  for (const app of APPS) {
    it(`${app}: every literal key exists in its namespace or common`, () => {
      const missing: string[] = [];
      for (const file of walk(path.join(ROOT, app))) {
        const src = fs.readFileSync(file, 'utf8');
        if (!/react-i18next|@mesaas\/i18n/.test(src)) continue;

        // Namespaces the file can reach: every useTranslation(...) and { ns: '...' } in it,
        // plus `common` (the configured fallbackNS). Lenient by design: a key is accepted if
        // any of them has it.
        const namespaces = new Set(['common']);
        for (const m of src.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g))
          for (const s of m[1].match(/['"][^'"]+['"]/g) ?? []) namespaces.add(s.slice(1, -1));
        for (const m of src.matchAll(/\bns:\s*['"]([^'"]+)['"]/g)) namespaces.add(m[1]);

        for (const m of src.matchAll(/\b(?:t|i18n\.t|t[A-Z]\w*|tc)\(\s*(['"])([^'"\n]+)\1/g)) {
          const raw = m[2];
          if (!/^(?:[\w-]+:)?[A-Za-z][\w-]*(?:\.[\w-]+)*$/.test(raw)) continue;
          const [ns, key] = raw.includes(':') ? raw.split(':') : [null, raw];
          const ok = ns ? resolves(ns, key) : [...namespaces].some((n) => resolves(n, key));
          if (!ok) missing.push(`${path.relative(ROOT, file)}: ${raw}`);
        }
      }
      expect([...new Set(missing)]).toEqual([]);
    });
  }
});
