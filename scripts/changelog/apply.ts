import { readFileSync, writeFileSync } from 'node:fs';
import { changelogSchema, changelogReleaseSchema } from '../../apps/crm/src/content/changelog.schema';
import { prependRelease } from '../../apps/crm/src/content/changelog.logic';

// Input JSON shape: { batchMaxMergedAt: string, release?: { date, summary?, items[] } }
const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: tsx scripts/changelog/apply.ts <entries.json>');
  process.exit(1);
}

const CHANGELOG = 'apps/crm/src/content/changelog.json';
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const changelog = changelogSchema.parse(JSON.parse(readFileSync(CHANGELOG, 'utf8')));

let next;
if (input.release && Array.isArray(input.release.items) && input.release.items.length) {
  const release = changelogReleaseSchema.parse(input.release);
  next = prependRelease(changelog, release, input.batchMaxMergedAt);
} else {
  next = { ...changelog, lastMergedAt: input.batchMaxMergedAt }; // watermark-only update
}

changelogSchema.parse(next); // final validation before writing
writeFileSync(CHANGELOG, JSON.stringify(next, null, 2) + '\n');
console.log(`changelog.json updated (lastMergedAt=${next.lastMergedAt}, releases=${next.releases.length})`);
