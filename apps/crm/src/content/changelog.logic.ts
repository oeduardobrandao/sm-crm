import type { Changelog, ChangelogItem, ChangelogRelease } from './changelog.schema';
import { changelogItemSchema } from './changelog.schema';

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

// Platform-admin work (apps/admin) is never customer-visible; the runbook bans
// it editorially and this drops the conventionally scoped part deterministically.
// Matches "admin" plus hyphenated variants ("admin-perf", "platform-admin") but
// not scopes that merely contain the letters ("administracao"), so a customer-
// facing workspace-role change is not silently dropped.
function isExcludedScope(scope: string): boolean {
  return scope === 'admin' || scope.startsWith('admin-') || scope.endsWith('-admin');
}

/** Lower bound (YYYY-MM-DD) for the gh merged-PR search. */
export function cutoffDate(changelog: Changelog, fallbackDate: string): string {
  return changelog.lastMergedAt ? changelog.lastMergedAt.slice(0, 10) : fallbackDate;
}

function titlePrefix(title: string): string {
  const m = title.match(/^(\w+)(\([^)]*\))?!?:/);
  return m ? m[1].toLowerCase() : '';
}

function titleScope(title: string): string {
  const m = title.match(/^\w+\(([^)]*)\)!?:/);
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
    if (isExcludedScope(titleScope(p.title))) return false;
    return INCLUDED_PREFIXES.includes(titlePrefix(p.title));
  });
}

/**
 * Routes the LLM may attach to an entry. Deterministic allowlist: the model picks
 * an href from here (or nothing); labels are always ours, never the model's.
 */
export const LINK_CATALOG: { href: string; label: string }[] = [
  { href: '/entregas', label: 'Abrir Entregas' },
  { href: '/calendario', label: 'Abrir o Calendário' },
  { href: '/clientes', label: 'Abrir Clientes' },
  { href: '/analytics', label: 'Abrir Analytics' },
  { href: '/financeiro', label: 'Abrir Financeiro' },
  { href: '/contratos', label: 'Abrir Contratos' },
  { href: '/equipe', label: 'Abrir Equipe' },
  { href: '/ideias', label: 'Abrir Ideias' },
  { href: '/arquivos', label: 'Abrir Arquivos' },
  { href: '/mensagens', label: 'Abrir Mensagens' },
  { href: '/tarefas', label: 'Abrir Tarefas' },
  { href: '/leads', label: 'Abrir Leads' },
  { href: '/ajuda', label: 'Central de Ajuda' },
  { href: '/importar', label: 'Importar dados' },
  { href: '/precos', label: 'Ver planos' },
  { href: '/blog', label: 'Ler no blog' },
];

/** Monday (UTC, YYYY-MM-DD) of the ISO week containing the given ISO timestamp. */
function isoWeekMonday(mergedAt: string): string {
  const d = new Date(mergedAt);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Group PRs by the ISO week they merged in, oldest week first. Each group's
 * `date` is the last merge date in that week — it becomes the release date, so
 * a multi-week backlog publishes as properly dated weekly blocks.
 */
export function groupByWeek(prs: PullRequest[]): { date: string; prs: PullRequest[] }[] {
  const byWeek = new Map<string, PullRequest[]>();
  for (const p of prs) {
    const key = isoWeekMonday(p.mergedAt);
    byWeek.set(key, [...(byWeek.get(key) ?? []), p]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      date: group.reduce((max, p) => (p.mergedAt > max ? p.mergedAt : max), '').slice(0, 10),
      prs: group,
    }));
}

const TYPE_SYNONYMS: Record<string, ChangelogItem['type']> = {
  feature: 'feature',
  feat: 'feature',
  new: 'feature',
  novidade: 'feature',
  novo: 'feature',
  fix: 'fix',
  bugfix: 'fix',
  bug: 'fix',
  hotfix: 'fix',
  correcao: 'fix',
  correção: 'fix',
};

/** Em/en dashes read as AI boilerplate in pt-BR copy; swap for plain punctuation. */
export function scrubDashes(s: string, midSentence = false): string {
  return s
    .replace(/\s+[—–]\s+/g, midSentence ? ', ' : ': ')
    .replace(/[—–]/g, '-')
    .trim();
}

export interface SanitizeOptions {
  /** PR numbers actually offered to the LLM — anything else was hallucinated. */
  allowedPrNumbers: number[];
  /** PRs already published (dropped here; apply.ts dedups again). */
  existingPrNumbers: number[];
}

/**
 * Deterministic cleanup of raw LLM items so a sloppy model response degrades to
 * fewer entries instead of a crashed run (the 2026-07-18 failure mode):
 * coerce type synonyms, resolve links against LINK_CATALOG, scrub dashes, and
 * drop anything that still doesn't satisfy the schema.
 */
export function sanitizeItems(raw: unknown, opts: SanitizeOptions): ChangelogItem[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(opts.allowedPrNumbers);
  const seen = new Set(opts.existingPrNumbers);
  const out: ChangelogItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const it = entry as Record<string, unknown>;
    const pr = typeof it.pr === 'number' && Number.isInteger(it.pr) ? it.pr : NaN;
    if (!allowed.has(pr) || seen.has(pr)) continue;

    const type =
      TYPE_SYNONYMS[
        String(it.type ?? '')
          .trim()
          .toLowerCase()
      ] ?? 'improvement';
    const rawHref =
      typeof it.link === 'string' ? it.link : (it.link as { href?: unknown } | null)?.href;
    const link = LINK_CATALOG.find((l) => l.href === String(rawHref ?? '').trim());

    const candidate = {
      type,
      area: scrubDashes(String(it.area ?? '')),
      title: scrubDashes(String(it.title ?? '')),
      description: scrubDashes(String(it.description ?? ''), true),
      pr,
      ...(link ? { link } : {}),
    };
    const parsed = changelogItemSchema.safeParse(candidate);
    if (!parsed.success) continue;
    seen.add(pr);
    out.push(parsed.data);
  }
  return out;
}

/** Prepend several releases (oldest first ends up deepest; newest ends up first). */
export function prependReleases(
  changelog: Changelog,
  releases: ChangelogRelease[],
  newLastMergedAt: string,
): Changelog {
  const ordered = [...releases].sort((a, b) => a.date.localeCompare(b.date));
  let next = changelog;
  for (const release of ordered) next = prependRelease(next, release, newLastMergedAt);
  return { ...next, lastMergedAt: newLastMergedAt };
}

/** Prepend a release (dedup items by pr) and advance the watermark. */
export function prependRelease(
  changelog: Changelog,
  release: ChangelogRelease,
  newLastMergedAt: string,
): Changelog {
  const existing = new Set(changelog.releases.flatMap((r) => r.items.map((i) => i.pr)));
  const items = release.items.filter((i) => !existing.has(i.pr));
  const releases = items.length
    ? [{ ...release, items }, ...changelog.releases]
    : changelog.releases;
  return { lastMergedAt: newLastMergedAt, releases };
}
