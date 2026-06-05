import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { cutoffDate, selectPRs, type PullRequest } from '../../apps/crm/src/content/changelog.logic';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

const CHANGELOG = 'apps/crm/src/content/changelog.json';
const changelog = changelogSchema.parse(JSON.parse(readFileSync(CHANGELOG, 'utf8')));
const cutoff = cutoffDate(changelog, daysAgo(7));

const raw = execFileSync(
  'gh',
  ['pr', 'list', '--state', 'merged', '--base', 'main', '--search', `merged:>=${cutoff}`, '--limit', '100',
   '--json', 'number,title,body,labels,mergedAt'],
  { encoding: 'utf8' },
);

const prs: PullRequest[] = JSON.parse(raw).map((p: any) => ({
  number: p.number,
  title: p.title,
  body: p.body ?? '',
  labels: (p.labels ?? []).map((l: any) => l.name),
  mergedAt: p.mergedAt,
}));

const existingPrNumbers = changelog.releases.flatMap((r) => r.items.map((i) => i.pr));
const selected = selectPRs(prs, { lastMergedAt: changelog.lastMergedAt, existingPrNumbers });
const batchMaxMergedAt = selected.reduce((max, p) => (p.mergedAt > max ? p.mergedAt : max), changelog.lastMergedAt);

console.log(JSON.stringify({ selected, batchMaxMergedAt, previousLastMergedAt: changelog.lastMergedAt }, null, 2));
