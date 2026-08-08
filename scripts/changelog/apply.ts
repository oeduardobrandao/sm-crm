import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  changelogSchema,
  changelogReleaseSchema,
  type ChangelogItem,
  type ChangelogRelease,
} from '../../apps/crm/src/content/changelog.schema';
import { prependReleases } from '../../apps/crm/src/content/changelog.logic';

// Input JSON shape: { batchMaxMergedAt: string, releases?: [{ date, summary?, items[] }] }
// (legacy single `release` object still accepted).
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: tsx scripts/changelog/apply.ts <entries.json>');
  process.exit(1);
}

const CHANGELOG = 'apps/crm/src/content/changelog.json';
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const changelog = changelogSchema.parse(JSON.parse(readFileSync(CHANGELOG, 'utf8')));

// Screenshot convention: a feature PR commits its image as
// public/novidades/pr-<n>.<ext>; the matching entry picks it up here —
// deterministically, never from LLM output.
function attachImage(item: ChangelogItem): ChangelogItem {
  if (item.image) return item;
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    if (existsSync(`public/novidades/pr-${item.pr}.${ext}`)) {
      return { ...item, image: `/novidades/pr-${item.pr}.${ext}` };
    }
  }
  return item;
}

const rawReleases: unknown[] = Array.isArray(input.releases)
  ? input.releases
  : input.release
    ? [input.release]
    : [];
const releases: ChangelogRelease[] = rawReleases
  .filter((r: any) => Array.isArray(r?.items) && r.items.length)
  .map((r) => changelogReleaseSchema.parse(r))
  .map((r) => ({ ...r, items: r.items.map(attachImage) }));

const next = releases.length
  ? prependReleases(changelog, releases, input.batchMaxMergedAt)
  : { ...changelog, lastMergedAt: input.batchMaxMergedAt }; // watermark-only update

changelogSchema.parse(next); // final validation before writing
writeFileSync(CHANGELOG, JSON.stringify(next, null, 2) + '\n');
console.log(`changelog.json updated (lastMergedAt=${next.lastMergedAt}, releases=${next.releases.length})`);
