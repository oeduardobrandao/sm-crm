import type { Changelog, ChangelogRelease } from './changelog.schema';

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

/** Lower bound (YYYY-MM-DD) for the gh merged-PR search. */
export function cutoffDate(changelog: Changelog, fallbackDate: string): string {
  return changelog.lastMergedAt ? changelog.lastMergedAt.slice(0, 10) : fallbackDate;
}

function titlePrefix(title: string): string {
  const m = title.match(/^(\w+)(\([^)]*\))?!?:/);
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
    return INCLUDED_PREFIXES.includes(titlePrefix(p.title));
  });
}

/** Prepend a release (dedup items by pr) and advance the watermark. */
export function prependRelease(
  changelog: Changelog,
  release: ChangelogRelease,
  newLastMergedAt: string,
): Changelog {
  const existing = new Set(changelog.releases.flatMap((r) => r.items.map((i) => i.pr)));
  const items = release.items.filter((i) => !existing.has(i.pr));
  const releases = items.length ? [{ ...release, items }, ...changelog.releases] : changelog.releases;
  return { lastMergedAt: newLastMergedAt, releases };
}
